// screens/navigation/NavigationScreen.js
import React, { useEffect, useState, useRef } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { getCurrentPositionAsync, requestForegroundPermissionsAsync } from 'expo-location';
import * as Speech from 'expo-speech';

import { reverseGeocode, geocode } from '../../utils/navigation/tmap';
import { useAutoSTT, resetSTTLock } from '@services/stt/useAutoSTT'; 
//import { speakText } from '@utils/tts';

const STT_ENDPOINT = process.env.EXPO_PUBLIC_STT_SERVER_URL;

export default function NavigationScreen({ navigation }) {
  const [currentLocation, setCurrentLocation] = useState(null);
  const [currentAddress, setCurrentAddress] = useState('');
  const [destination, setDestination] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);

  const isFocused = useIsFocused();

  // 버튼을 눌렀을 때만 STT 시작
  const [sttOn, setSttOn] = useState(false);
  const listenTimeoutRef = useRef(null);
  const suppressUntilRef = useRef(0); // TTS 에코 무시창

  // ─────────────────────────────────────────
  // 오인식 보정/정규화
  const normalizePhrase = (s = '') => {
    let t = (s || '').toLowerCase();
    // 공백/문장부호 정리
    t = t.replace(/[.,!?~]/g, ' ').replace(/\s+/g, ' ').trim();

    // 흔한 오인식 사전
    const dict = [
      ['구디역', '구로디지털단지역'],
      ['구디', '구로디지털단지'],
      ['구디 디지털', '구로디지털단지', '구로 기진탈 단지'],
      ['슬림', '신림'],
      ['슬림역', '신림역'],
      ['강남 여', '강남역'],
      ['여', '역'], // 끝 단어가 '여'로 들리는 경우 보정
    ];

    for (const [wrong, right] of dict) {
      t = t.replace(new RegExp(wrong, 'g'), right);
    }

    // 조사/접속어 간단 제거
    t = t.replace(/\b(으로|로|까지|으로요|로요|요|좀|에|를|을|은|는|이|가)\b/g, ' ').replace(/\s+/g, ' ').trim();

    // '여'로 끝난 단어를 '역'으로 보정 (예: '구디여' → '구디역')
    t = t.replace(/([가-힣])여\b/g, '$1역');

    return t;
  };

  // 화면 떠나면 청취 중지
  useEffect(() => {
    if (!isFocused) {
      setSttOn(false);
      clearTimeout(listenTimeoutRef.current);
      try { Speech.stop(); } catch {}
    }
  }, [isFocused]);

  useEffect(() => { resetSTTLock?.(); }, []);

  // 🎙️ 버튼 눌렀을 때만 STT 트리거
  const handleSTT = () => {
    if (!currentLocation) {
      Speech.speak('현재 위치를 먼저 확인해 주세요.', { language: 'ko-KR' });
      return;
    }
    try { Speech.stop(); } catch {}
    const now = Date.now();
    suppressUntilRef.current = now + 1200; // TTS 직후 1.2초 에코 무시
    Speech.speak('원하시는 목적지를 말씀해 주세요.', { language: 'ko-KR', rate: 1.15 });

    // 안내 멘트 직후 약간 여유를 두고 청취 시작
    setTimeout(() => {
      setSttOn(true);
      clearTimeout(listenTimeoutRef.current);
      listenTimeoutRef.current = setTimeout(() => {
        setSttOn(false);
        Speech.speak('시간이 초과되었습니다. 다시 버튼을 눌러 주세요.', { language: 'ko-KR', rate: 1.15 });
      }, 10000); // 청취 10초
    }, 1200);
  };

  // ✅ 버튼으로 시작되는 STT: 목적지/전역명령 처리 후 자동 종료
  useAutoSTT({
    endpoint: STT_ENDPOINT,
    segmentMs: 6500,          // 조금 길게
    enabled: isFocused && sttOn,
    mode: 'prompt',
    useCue: true,
    cueChime: true,
    cueSpeak: false,
    listenTimeoutMs: 11000,   // 여유 증가
    noResultText: '',

    onResult: async ({ text }) => {
      const raw = (text || '').trim();
      if (!raw) return;

      // TTS 에코 무시창
      if (Date.now() < suppressUntilRef.current) {
        console.log('⏸️ suppress(에코) skip:', raw);
        return;
      }

      console.log('✅ [NavigationScreen STT]:', raw);

      // 한 번 처리하면 STT 끄기
      clearTimeout(listenTimeoutRef.current);
      setSttOn(false);
      try { Speech.stop(); } catch {}

      // 전역 명령 우선
      const lower = raw.toLowerCase();
      if (raw.includes('객체')) { Speech.speak('객체 인식으로 이동합니다.', { language: 'ko-KR' }); navigation.navigate('Home'); return; }
      if (raw.includes('글자') || raw.includes('글자인식') || lower.includes('ocr') || raw.includes('텍스트')) {
        Speech.speak('글자 인식으로 이동합니다.', { language: 'ko-KR' }); navigation.navigate('OCR'); return;
      }
      if (raw.includes('설정')) { Speech.speak('설정으로 이동합니다.', { language: 'ko-KR' }); navigation.navigate('Setting'); return; }
      if (raw.includes('취소') || raw.includes('중지') || raw.includes('그만')) {
        Speech.speak('음성 입력을 종료합니다.', { language: 'ko-KR' }); return;
      }

      // 목적지 정규화/보정
      const norm = normalizePhrase(raw);
      console.log('🧭 주소 검색 시작:', norm);
      setDestinationInput(norm);
      await handleSearchDestination(norm);
    },

    onError: (err) => {
      console.log('🛑 [Navigation STT error]:', err?.message ?? err);
      clearTimeout(listenTimeoutRef.current);
      setSttOn(false);
    },
  });

  // 📍 현재 위치 가져오기
  const fetchLocation = async () => {
    try {
      setIsLoading(true);
      const { status } = await requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('위치 권한 필요', '길찾기 기능을 사용하려면 위치 권한이 필요합니다.');
        setCurrentAddress('위치 권한이 필요합니다.');
        setIsLoading(false);
        return;
      }

      const location = await getCurrentPositionAsync({
        accuracy: 5,
        timeInterval: 10000,
        distanceInterval: 10,
      });

      const { latitude, longitude } = location.coords;
      setCurrentLocation({ latitude, longitude });

      try {
        const addr = await reverseGeocode(latitude, longitude);
        setCurrentAddress(addr);
      } catch {
        setCurrentAddress(`위치: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
      }

      Speech.speak('목적지를 입력하거나, 아래 버튼을 눌러 음성으로 입력할 수 있습니다.', { language: 'ko-KR' });
    } catch (e) {
      console.error('📍 위치 가져오기 실패:', e);
      setCurrentAddress('현재 위치를 불러올 수 없습니다.');
      Speech.speak('위치를 가져올 수 없습니다. 다시 시도해 주세요.', { language: 'ko-KR' });
    } finally {
      setIsLoading(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchLocation();
      setDestination('');
      setDestinationInput('');
      setSttOn(false);
      clearTimeout(listenTimeoutRef.current);
    }, [])
  );

  // 목적지 검색 → Route로 이동
  const handleSearchDestination = async (searchText) => {
    if (!searchText.trim()) {
      Alert.alert('알림', '목적지를 입력해 주세요.');
      return;
    }
    if (!currentLocation) {
      Alert.alert('알림', '현재 위치를 먼저 확인해 주세요.');
      return;
    }

    try {
      setIsSearching(true);
      const result = await geocode(searchText);

      setDestination(result.name || searchText);
      setDestinationInput(searchText);

      navigation.navigate('Route', {
        currentLocation,
        destination: result.name || searchText,
        destinationCoords: {
          latitude: result.latitude,
          longitude: result.longitude,
        },
      });
    } catch (error) {
      console.error('목적지 검색 실패:', error);
      Alert.alert(
        '검색 실패',
        '해당 주소를 찾을 수 없습니다.\n\n예시: 신림역, 강남역, 서울역, 홍대입구역, 명동, 강남대로\n\n다시 시도해 주세요.'
      );
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>📍 길 찾기</Text>

      <Text style={styles.label}>출발지</Text>
      <View style={styles.inputBoxActive}>
        <Text style={styles.inputText}>
          {isLoading ? '위치 확인 중...' : currentAddress}
        </Text>
      </View>

      <Text style={styles.label}>도착지</Text>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          placeholder="목적지를 입력하세요 (예: 신림역, 강남역, 서울역)"
          placeholderTextColor="#666"
          value={destinationInput}
          onChangeText={setDestinationInput}
          onSubmitEditing={() => handleSearchDestination(destinationInput)}
        />
        <TouchableOpacity
          style={[styles.searchButton, isSearching && styles.searchButtonDisabled]}
          onPress={() => handleSearchDestination(destinationInput)}
          disabled={isSearching || !destinationInput.trim()}
        >
          <Text style={styles.searchButtonText}>
            {isSearching ? '검색 중...' : '검색'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.helpContainer}>
        <Text style={styles.helpText}>
          💡 검색 예시: 신림역, 강남역, 서울역, 홍대입구역, 명동, 강남대로
        </Text>
      </View>

      <View style={styles.orContainer}>
        <Text style={styles.orText}>또는</Text>
      </View>

      <TouchableOpacity
        style={[styles.voiceButton, !currentLocation && styles.voiceButtonDisabled]}
        onPress={handleSTT}
        disabled={!currentLocation}
      >
        <Text style={styles.voiceButtonText}>
          {sttOn ? '청취 중… 말씀해 주세요' : '음성으로 목적지 입력'}
        </Text>
      </TouchableOpacity>

      {destination && (
        <View style={styles.resultContainer}>
          <Text style={styles.resultLabel}>선택된 목적지:</Text>
          <Text style={styles.resultText}>{destination}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 24 },
  title: { fontSize: 28, color: '#4FC3F7', fontWeight: 'bold', textAlign: 'center', marginVertical: 20 },
  label: { color: '#fff', fontSize: 18, marginTop: 30, marginBottom: 8 },
  inputBoxActive: { backgroundColor: '#444', padding: 14, borderRadius: 8 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  textInput: { flex: 1, backgroundColor: '#222', padding: 14, borderRadius: 8, color: '#fff', fontSize: 16 },
  searchButton: { backgroundColor: '#4FC3F7', padding: 14, borderRadius: 8, minWidth: 60, alignItems: 'center' },
  searchButtonDisabled: { backgroundColor: '#666' },
  searchButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  orContainer: { alignItems: 'center', marginVertical: 20 },
  orText: { color: '#666', fontSize: 16 },
  voiceButton: { backgroundColor: '#333', padding: 16, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#4FC3F7' },
  voiceButtonDisabled: { backgroundColor: '#111', borderColor: '#333', opacity: 0.5 },
  voiceButtonText: { color: '#4FC3F7', fontSize: 16, fontWeight: 'bold' },
  resultContainer: { marginTop: 20, padding: 16, backgroundColor: '#222', borderRadius: 8 },
  resultLabel: { color: '#4FC3F7', fontSize: 14, marginBottom: 4 },
  resultText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  helpContainer: { marginTop: 8, padding: 12, backgroundColor: '#1a1a1a', borderRadius: 6, borderLeftWidth: 3, borderLeftColor: '#4FC3F7' },
  helpText: { color: '#aaa', fontSize: 12, lineHeight: 16 },
  inputText: { color: '#fff', fontSize: 16 },
});
