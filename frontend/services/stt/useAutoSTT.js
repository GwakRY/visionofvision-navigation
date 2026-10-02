
import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import chimeDefault from '../../../assets/ding-36029.mp3';


/** 전역 STT 락(동시 마이크 점유 방지) */
let GLOBAL_OWNER_TOKEN = null;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 전역 상태: prepare 충돌 방지 / 녹음 중 표시 (다른 훅 인스턴스와 협력용)
if (typeof globalThis !== 'undefined') {
  if (globalThis.__useAutoSTT_prepCount == null) globalThis.__useAutoSTT_prepCount = 0;
  if (globalThis.__useAutoSTT_isRecording == null) globalThis.__useAutoSTT_isRecording = false;
}

/**
 * useAutoSTT
 * mode:
 *  - "prompt": 띠링(+선택적 안내) → 타임아웃 내 인식 유도(재프롬프트 포함)
 *  - "continuous": 안내/타임아웃 없이 연속 수집
 */
export function useAutoSTT({
  endpoint,
  enabled,
  onResult,
  onError,
  segmentMs = 2500,

  mode = 'prompt',

  // 큐(청취 프롬프트) 옵션
  useCue = true,
  cueChime = true,
  cueSpeak = true,
  cueText = '지금 말씀하세요.',
  cueDelayMs = 500,

  // 미인식 처리
  listenTimeoutMs = 6500,
  retryOnNoResult = true,
  noResultText = '다시 말씀해 주세요.',

  // 효과음(mp3)
  useChime = true,
  chimeModule = chimeDefault,

  // 큐 직전 TTS 중단
  stopBeforeCue = true,
}) {
  const ownerTokenRef = useRef(Symbol('stt-owner'));
  const recordingRef = useRef(null);

  // 🔒 녹음 상태 직렬화용 플래그
  const preparingRef = useRef(false);
  const startingRef  = useRef(false);
  const stoppingRef  = useRef(false);

  const segmentTimerRef = useRef(null);
  const listenTimerRef  = useRef(null);
  const mountedRef = useRef(true);
  const enabledRef = useRef(false);

  const lastHeardAtRef = useRef(0); // 마지막 인식 성공 시각
  const lastSentAtRef  = useRef(0); // 마지막 세그먼트 서버 전송 시각
  const inflightRef    = useRef(0); // 서버 응답 대기 중 개수

  // 🔔 chime
  const chimeRef = useRef(null);
  const chimeReadyRef = useRef(false);

  // 🔕 외부 완전중지 플래그 (외부 stop()에서만 true로 설정)
  const hardStoppedRef = useRef(false);

  const hasLock = () => GLOBAL_OWNER_TOKEN === ownerTokenRef.current;
  const acquireLock = () => {
    if (GLOBAL_OWNER_TOKEN && GLOBAL_OWNER_TOKEN !== ownerTokenRef.current) return false;
    GLOBAL_OWNER_TOKEN = ownerTokenRef.current;
    return true;
  };
  const releaseLock = () => { if (hasLock()) GLOBAL_OWNER_TOKEN = null; };

  const clearSegmentTimer = () => {
    if (segmentTimerRef.current) {
      clearTimeout(segmentTimerRef.current);
      segmentTimerRef.current = null;
    }
  };
  const clearListenTimer = () => {
    if (listenTimerRef.current) {
      clearTimeout(listenTimerRef.current);
      listenTimerRef.current = null;
    }
  };

  const safeStop = async () => {
    clearSegmentTimer();
    clearListenTimer();

    // 다른 중지 동작과 경합 방지
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) {
        try { await rec.stopAndUnloadAsync(); } catch {}
      }
      // 재생 중인 chime도 즉시 정지
      try { await chimeRef.current?.stopAsync(); } catch {}
    } finally {
      stoppingRef.current = false;
      // 준비/시작 중이던 것도 취소 느낌으로 내려준다
      preparingRef.current = false;
      startingRef.current  = false;
      // 전역 녹음 상태 클리어
      if (typeof globalThis !== 'undefined') globalThis.__useAutoSTT_isRecording = false;
    }
  };

  // preload/unload chime
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      if (useChime && chimeModule) {
        try {
          const { sound } = await Audio.Sound.createAsync(chimeModule, { shouldPlay: false });
          chimeRef.current = sound; chimeReadyRef.current = true;
        } catch (e) {
          console.warn('🔔 chime preload 실패 → TTS 대체', e?.message ?? e);
          chimeReadyRef.current = false;
        }
      }
    })();
    return () => {
      mountedRef.current = false;
      stopRecording(true);
      releaseLock();
      (async () => {
        try { await chimeRef.current?.unloadAsync(); } catch {}
        chimeRef.current = null; chimeReadyRef.current = false;
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    };
  }, []);

  // enable toggle
  useEffect(() => {
    enabledRef.current = !!enabled;
    if (enabledRef.current) startFlow();
    else stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mode, useCue, cueChime, cueSpeak]);

  const playChime = async () => {
    // 중지 의도 시점 이후엔 재생 금지
    if (!mountedRef.current || !enabledRef.current || !hasLock() || hardStoppedRef.current) return;
    try {
      if (useChime && chimeReadyRef.current && chimeRef.current) {
        try { await chimeRef.current.setPositionAsync(0); } catch {}
        await chimeRef.current.playAsync();
      } else {
        Speech.speak('띠링', { language: 'ko-KR', rate: 1.6 });
      }
    } catch {
      Speech.speak('띠링', { language: 'ko-KR', rate: 1.6 });
    }
  };

  async function startFlow() {
    // 새로 시작할 때는 외부 완전중지 해제
    hardStoppedRef.current = false;

    if (!acquireLock()) return;

    try {
      if (stopBeforeCue) { try { Speech.stop(); } catch {} }

      const perm = await Audio.requestPermissionsAsync();
      if (!perm?.granted) {
        onError?.(new Error('MIC_PERMISSION_DENIED'));
        releaseLock(); return;
      }

      const IosMode = Audio?.InterruptionModeIOS?.DoNotMix ?? Audio?.INTERRUPTION_MODE_IOS_DO_NOT_MIX ?? 1;
      const AndroidMode = Audio?.InterruptionModeAndroid?.DoNotMix ?? Audio?.INTERRUPTION_MODE_ANDROID_DO_NOT_MIX ?? 1;
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        interruptionModeIOS: IosMode,
        interruptionModeAndroid: AndroidMode,
        playThroughEarpieceAndroid: false,
      });

      // 기존 세션 정리 (hardStoppedRef는 건드리지 않음)
      await safeStop();
      await delay(120);

      if (!mountedRef.current || !enabledRef.current || !hasLock() || hardStoppedRef.current) { releaseLock(); return; }

      // PROMPT 모드: 큐(효과음/안내)
      if (mode === 'prompt' && useCue) {
        if (stopBeforeCue) { try { Speech.stop(); } catch {} }
        if (cueChime) { await playChime(); await delay(150); }
        if (cueSpeak) {
          Speech.speak(cueText, { language: 'ko-KR', rate: 1.4 });
          await delay(cueDelayMs);
        }
      }

      await startRecordingGuarded();
      if (mode === 'prompt') armListenTimeout();
    } catch (err) {
      console.error('🛑 startFlow 실패:', err);
      onError?.(err); releaseLock();
    }
  }

  function armListenTimeout() {
    clearListenTimer();
    if (!retryOnNoResult) return;

    const tick = async () => {
      if (hardStoppedRef.current) return;

      // ⏳ 응답 대기/최근 전송은 '활동'으로 간주 → 타임아웃 유예
      const lastActivity = Math.max(lastHeardAtRef.current, lastSentAtRef.current);
      const elapsed = Date.now() - lastActivity;

      // 아직 응답 대기 중이거나(activity 신선) 타임아웃 미달이면, 조금 후 다시 체크
      if (inflightRef.current > 0 || elapsed < listenTimeoutMs - 50) {
        listenTimerRef.current = setTimeout(tick, 400); // 0.4s마다 재확인
        return;
      }

      // 여기까지 왔다는 건: (대기 없음) && (listenTimeout 초과)
      try { Speech.stop(); } catch {}

      // ✅ 재프롬프트 전엔 반드시 녹음을 중단
      await safeStop();

      if (noResultText) {
        Speech.speak(noResultText, { language: 'ko-KR', rate: 1.4 });
        await delay(600);
      }
      if (useCue) {
        if (cueChime) { await playChime(); await delay(150); }
        if (cueSpeak) {
          Speech.speak(cueText, { language: 'ko-KR', rate: 1.4 });
          await delay(cueDelayMs);
        }
      }

      await startRecordingGuarded();
      armListenTimeout(); // 다음 라운드
    };

    // 최초 기동은 listenTimeout 후에 첫 체크 시작
    listenTimerRef.current = setTimeout(tick, listenTimeoutMs);
  }

  /** 녹음 시작(경합 방지 가드 포함) */
  async function startRecordingGuarded() {
    if (hardStoppedRef.current) return;
    if (!mountedRef.current || !enabledRef.current || !hasLock()) return;

    // 이미 녹음 중이면 재시작 불필요
    if (recordingRef.current) return;
    if (preparingRef.current || startingRef.current || stoppingRef.current) {
      // 잠깐 대기 후 한 번 더 시도
      await delay(80);
      if (recordingRef.current || preparingRef.current || startingRef.current || stoppingRef.current) return;
    }

    // --- 추가: 다른 인스턴스가 prepare 중이면 잠깐 기다려서 충돌 방지 ---
    try {
      let waitLoops = 0;
      while ((globalThis.__useAutoSTT_prepCount ?? 0) > 0 && waitLoops < 40) {
        await delay(40);
        waitLoops++;
      }
    } catch (e) {
      // ignore
    }

    preparingRef.current = true;
    const rec = new Audio.Recording();
    try {
      // Mark global prep count so other instances wait
      if (typeof globalThis !== 'undefined') globalThis.__useAutoSTT_prepCount = (globalThis.__useAutoSTT_prepCount ?? 0) + 1;
      try {
        await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      } finally {
        // always decrement prepCount once prepareToRecordAsync resolves/rejects
        if (typeof globalThis !== 'undefined') globalThis.__useAutoSTT_prepCount = Math.max(0, (globalThis.__useAutoSTT_prepCount ?? 1) - 1);
      }
    } catch (e) {
      preparingRef.current = false;
      console.error('🛑 녹음 prepare 실패:', e);
      onError?.(e);
      return;
    }
    preparingRef.current = false;

    startingRef.current = true;
    try {
      await rec.startAsync();
      recordingRef.current = rec;
      // 전역 녹음 상태 표시
      if (typeof globalThis !== 'undefined') globalThis.__useAutoSTT_isRecording = true;

      console.log('🎙️ 녹음 시작');
      scheduleNext();
    } catch (e) {
      console.error('🛑 녹음 start 실패:', e);
      onError?.(e);
      // 실패 시 레이스 가능성 → 안전 정리
      try { await rec.stopAndUnloadAsync(); } catch {}
      recordingRef.current = null;
    } finally {
      startingRef.current = false;
    }
  }

  function scheduleNext() {
    if (!mountedRef.current || !enabledRef.current || !hasLock() || hardStoppedRef.current) { releaseLock(); return; }

    clearSegmentTimer();
    segmentTimerRef.current = setTimeout(async () => {
      if (hardStoppedRef.current) return;

      // 준비/중지/시작 중이면 조금 뒤에 다시
      if (preparingRef.current || startingRef.current || stoppingRef.current) {
        return scheduleNext();
      }

      try {
        const rec = recordingRef.current;
        if (!rec) {
          // 세션이 없다면 부드럽게 재시작
          await startRecordingGuarded();
          return scheduleNext();
        }

        // 현재 세그먼트 종료
        try { await rec.stopAndUnloadAsync(); } catch {}
        const uri = rec.getURI();
        recordingRef.current = null;
        // 전역 녹음 상태 클리어 (세그먼트 전송 시에는 녹음이 멈춘 상태)
        if (typeof globalThis !== 'undefined') globalThis.__useAutoSTT_isRecording = false;

        if (uri) {
          console.log('📤 세그먼트 전송', uri);
          await sendAudio(uri);
        }
        if (!mountedRef.current || !enabledRef.current || !hasLock() || hardStoppedRef.current) { releaseLock(); return; }

        await delay(60);
        await startRecordingGuarded(); // 다음 세그먼트 준비
        scheduleNext();
      } catch (e) {
        console.warn('⚠️ 세그먼트 처리 오류:', e);
        onError?.(e);
        // 백오프 후 재시도
        await delay(300);
        if (mountedRef.current && enabledRef.current && hasLock() && !hardStoppedRef.current) {
          await startRecordingGuarded();
          scheduleNext();
        } else {
          releaseLock();
        }
      }
    }, segmentMs);
  }

// ▶︎ useAutoSTT.js 안의 sendAudio 교체
async function sendAudio(uri) {
  // ❶ 9초 타임아웃 추가
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);

  try {
    const formData = new FormData();
    formData.append('audio', { uri, name: 'speech.m4a', type: 'audio/m4a' });

    const res = await fetch(endpoint, { method: 'POST', body: formData, signal: controller.signal });

    // ❷ 본문 로깅 (JSON/텍스트 모두 처리)
    const ctype = res.headers?.get?.('content-type') || '';
    let payload;
    try {
      payload = ctype.includes('application/json') ? await res.json() : await res.text();
    } catch (e) {
      payload = `<<parse error: ${e?.message}>>`;
    }
    console.log('🔎 [STT HTTP]', { status: res.status, ok: res.ok, body: payload });

    if (!res.ok) { onError?.(new Error(`HTTP_${res.status}`)); return; }

    // ❸ 텍스트 추출
    const text =
      (typeof payload === 'string' ? payload : (payload?.text ?? '')).trim();

    if (text) {
      lastHeardAtRef.current = Date.now();
      if (mode === 'prompt') { clearListenTimer(); armListenTimeout(); }
      console.log('✅ STT 결과:', text);
      onResult?.({ text });
    } else {
      console.log('ℹ️ 빈 결과(무음/불인식)');
    }
  } catch (err) {
    console.error('🛑 STT 전송 오류:', err?.name === 'AbortError' ? 'TIMEOUT' : err);
    onError?.(err);
  } finally {
    clearTimeout(timer);
  }
}


  async function stopRecording(force = false) {
    await safeStop();
    if (force || hasLock()) releaseLock();
  }

  /** 외부에서 완전 중지(타이머/녹음/chime/락 해제) 호출용 */
  const stop = async () => {
    enabledRef.current = false;
    hardStoppedRef.current = true;         // ✅ 외부 완전 중지일 때만 true
    await stopRecording(true);
  };

  return { stop };
}

/** 전역 락 초기화 */
export function resetSTTLock() {
  GLOBAL_OWNER_TOKEN = null;
  if (typeof globalThis !== 'undefined') {
    globalThis.__useAutoSTT_prepCount = 0;
    globalThis.__useAutoSTT_isRecording = false;
  }
}
