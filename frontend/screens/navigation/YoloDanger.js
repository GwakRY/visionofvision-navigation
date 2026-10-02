import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Vibration } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import io from 'socket.io-client';
import { Audio } from 'expo-av';
import { Dimensions } from 'react-native';
import * as Speech from "expo-speech";

import { classNameMap as classMap } from '../../constants/yoloClasseMapping';
import { speakWithOptions as speakText, stopSpeech as stopSpeaking } from '../../utils/speechHelper';
import { splitDetectionsBySide } from '../../utils/yolo/detectionProcessor';
import WarningOverlay from '../../components/yolo/WarningOverlay';

const getReadableName = (cls) => classMap?.[cls] ?? cls
const { width: previewWidth, height: previewHeight } = Dimensions.get('window');
const SERVER_URL = 'http://3.37.7.103:5004';

const ASSIST_SET = new Set([
  'bluesignal', 'crosswalk', 'redsignal', 'braille block',
]);

export default function YoloDanger({ cameraRef, permission, isFocused: parentIsFocused }) {
  const isFocusedLocal = useIsFocused();
  const isFocused = parentIsFocused ?? isFocusedLocal;

  const socketRef = useRef(null);

  const [detections, setDetections] = useState([]);
  const [photoSize, setPhotoSize] = useState({ width: 1, height: 1 });
  const [frameReady, setFrameReady] = useState(true);
  const [warningVisible, setWarningVisible] = useState(false);

  const lastSpokenMsgRef = useRef('');
  const ttsTimerRef = useRef(null);

  const hornRef = useRef(null);
  const lastHornAtRef = useRef(0);
  const HORN_COOLDOWN_MS = 1500;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          allowsRecordingIOS: false,
        });
        const { sound } = await Audio.Sound.createAsync(
          require('../../../assets/horn.mp3'),
          { shouldPlay: false, volume: 1.0 }
        );
        if (mounted) hornRef.current = sound;
      } catch (e) {
        console.warn('horn preload error:', e);
      }
    })();
    return () => {
      mounted = false;
      hornRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const playHorn = async () => {
    const now = Date.now();
    if (now - lastHornAtRef.current < HORN_COOLDOWN_MS) return;
    lastHornAtRef.current = now;
    try {
      const s = hornRef.current;
      if (s) {
        await s.setPositionAsync(0);
        await s.playAsync();
      }
    } catch (e) {
      console.warn('horn play error:', e);
    }
  };

  useEffect(() => {
    const sock = io(SERVER_URL, { transports: ['websocket'], reconnection: true });
    socketRef.current = sock;

    sock.on('connect', () => console.log('✅ Socket connected (YOLO)'));
    sock.on('disconnect', () => console.log('❌ Socket disconnected (YOLO)'));

    sock.on('detection', (data = []) => {
      const arr = Array.isArray(data) ? data : [];

      const red = arr.find(d => d.class_name === 'redsignal');
      const blue = arr.find(d => d.class_name === 'bluesignal');
      let filtered = arr;
      if (red && blue) {
        const areaRed = (red.bbox[2] - red.bbox[0]) * (red.bbox[3] - red.bbox[1]);
        const areaBlue = (blue.bbox[2] - blue.bbox[0]) * (blue.bbox[3] - blue.bbox[1]);
        if (areaRed >= areaBlue) {
          filtered = arr.filter(d => d.class_name !== 'bluesignal');
        } else {
          filtered = arr.filter(d => d.class_name !== 'redsignal');
        }
      }
      setDetections(filtered);

      const hasDangerApproach = filtered.some(d => d?.approaching && !ASSIST_SET.has(d.class_name));
      if (hasDangerApproach) {
        playHorn();
        Vibration.vibrate([0, 300, 120, 300], false);
        setWarningVisible(true);
        setTimeout(() => setWarningVisible(false), 1200);
      }
    });

    return () => {
      try { sock.disconnect(); } catch (e) {}
    };
  }, []);

  useEffect(() => {
    if (!permission?.granted || !isFocused) return;
    let interval = null;
    interval = setInterval(async () => {
      if (!frameReady) return;
      setFrameReady(false);

      try {
        const photo = await cameraRef?.current?.takePictureAsync({
          base64: true,
          quality: 0.3,
        });
        if (!photo) return;

        setPhotoSize({ width: photo.width, height: photo.height });
        const imgData = 'data:image/jpeg;base64,' + photo.base64;
        socketRef.current?.emit('image', {
          image: imgData,
          width: photo.width,
          height: photo.height,
        });
      } catch (e) {
        console.error('🚫 sendFrame error (YOLO)', e);
      } finally {
        setTimeout(() => setFrameReady(true), 5000);
      }
    }, 5000);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [permission, isFocused, frameReady, cameraRef]);

  useEffect(() => {
    if (photoSize.width <= 1 || detections.length === 0) return;

    const dangerArr = [];
    const assistArr = [];
    for (const d of detections) {
      if (ASSIST_SET.has(d.class_name)) assistArr.push(d);
      else dangerArr.push(d);
    }

    const [leftDangerArr, rightDangerArr] = splitDetectionsBySide(dangerArr, previewWidth, photoSize.width);
    let dangerMsg = '';
    if (leftDangerArr.length && rightDangerArr.length)
      dangerMsg = `왼쪽에는 ${leftDangerArr.map(getReadableName).join(', ')} 있고, 오른쪽에는 ${rightDangerArr.map(getReadableName).join(', ')} 있습니다.`;
    else if (leftDangerArr.length)
      dangerMsg = `왼쪽에 ${leftDangerArr.map(getReadableName).join(', ')} 있습니다.`;
    else if (rightDangerArr.length)
      dangerMsg = `오른쪽에 ${rightDangerArr.map(getReadableName).join(', ')} 있습니다.`;

    const [leftAssistArr, rightAssistArr] = splitDetectionsBySide(assistArr, previewWidth, photoSize.width);
    let assistMsg = '';
    if (leftAssistArr.length && rightAssistArr.length)
      assistMsg = `보조안내: 왼쪽에는 ${leftAssistArr.map(getReadableName).join(', ')} 있고, 오른쪽에는 ${rightAssistArr.map(getReadableName).join(', ')} 있습니다.`;
    else if (leftAssistArr.length)
      assistMsg = `보조안내: 왼쪽에 ${leftAssistArr.map(getReadableName).join(', ')} 있습니다.`;
    else if (rightAssistArr.length)
      assistMsg = `보조안내: 오른쪽에 ${rightAssistArr.map(getReadableName).join(', ')} 있습니다.`;

    const approachingArr = Array.from(new Set(dangerArr.filter(d => d?.approaching).map(d => d.class_name)));
    const distanceMsg = approachingArr.length ? `${approachingArr.map(getReadableName).join(', ')} 다가오고 있습니다.` : '';

    const combined = [dangerMsg, assistMsg, distanceMsg].filter(Boolean).join(' ');
    if (!combined) return;
    if (combined === lastSpokenMsgRef.current) return;

    if (ttsTimerRef.current) clearTimeout(ttsTimerRef.current);
    ttsTimerRef.current = setTimeout(() => {
      stopSpeaking();
      Speech.speak(combined);
      lastSpokenMsgRef.current = combined;
    }, 350);
  }, [detections, photoSize]);

  return (
    <View style={StyleSheet.absoluteFill}>
      {warningVisible && <WarningOverlay />}
    </View>
  );
}

const styles = StyleSheet.create({
  warningOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255, 0, 0, 0.5)', zIndex: 1000 },
});
