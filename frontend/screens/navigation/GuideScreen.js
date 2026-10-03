// screens/navigation/GuideScreen.js
import { useIsFocused } from '@react-navigation/native';
import { CameraView } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { GuideOverlay } from '../../components/navigation/GuideOverlay';
import { useCamera } from '../../hooks/navigation/useCamera';
import { useNavigationGuide } from '../../hooks/navigation/useNavigationGuide';
import { speakWithOptions, stopSpeech } from '../../utils/speechHelper';
import YoloDanger from './YoloDanger';

const API_SERVER_URL = process.env.EXPO_PUBLIC_AI_SERVER_URL;

const GuideScreen = ({ route, navigation }) => {
  const { currentLocation, destination, destinationCoords } = route.params || {};
  const isFocused = useIsFocused();

  // 훅 사용
  const {
    permission,
    requestPermission,
    cameraReady,
    cameraRef,
    handleCameraReady
  } = useCamera();

  const {
    pointDescription,
    nextPointDistance,
    destinationDistance,
    relativeAngle,
    navReady
  } = useNavigationGuide({
    currentLocation,
    destination,
    destinationCoords,
    onArrival: async () => {
      // 목적지 도착 처리
      if (destination && destinationCoords) {
        const isAlreadyInFavorites = await checkIfAlreadyInFavorites(destination);
        if (isAlreadyInFavorites) {
          setTimeout(() => navigation.navigate('NavigationScreen'), 1000);
        } else {
          setTimeout(() => {
            Alert.alert(
              '즐겨찾기 추가',
              `${destination}을(를) 즐겨찾기에 추가하시겠습니까?`,
              [
                { 
                  text: '아니오', 
                  style: 'cancel', 
                  onPress: () => setTimeout(() => navigation.navigate('NavigationScreen'), 1000) 
                },
                {
                  text: '예',
                  onPress: () => {
                    navigation.navigate('Setting', {
                      screen: 'Favorites',
                      params: {
                        addFromNavigation: true,
                        destinationName: '',
                        destinationAddress: destination,
                        destinationCoords: destinationCoords
                      }
                    });
                  }
                }
              ],
              { cancelable: false }
            );
          }, 3000);
        }
      } else {
        setTimeout(() => navigation.navigate('NavigationScreen'), 1000);
      }
    }
  });

  // 즐겨찾기 중복 체크
  const checkIfAlreadyInFavorites = async (address) => {
    try {
      const deviceId = await SecureStore.getItemAsync('deviceId');
      const url = `${API_SERVER_URL}/setting/favorites?device_id=${encodeURIComponent(deviceId)}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        const favorites = await response.json();
        return favorites.some(fav => fav.address === address);
      }
      return false;
    } catch (error) {
      console.error('즐겨찾기 확인 실패:', error);
      return false;
    }
  };

  // 화면 진입 TTS
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
    const welcomeMessage = destination
      ? `${destination}까지 실시간 안내를 시작합니다. 카메라가 준비되면 실시간 안내가 시작됩니다.`
      : '길찾기 안내를 시작합니다. 카메라가 준비되면 실시간 안내가 시작됩니다.';
    speakWithOptions(welcomeMessage);
    return () => { stopSpeech(); };
  }, [destination, navigation]);

  // 권한 UI
  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>카메라 권한 확인 중...</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>📵 카메라 권한이 필요합니다.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.buttonText}>카메라 권한 허용</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {isFocused && navReady && (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          onCameraReady={handleCameraReady}
        >
          <GuideOverlay
            pointDescription={pointDescription}
            nextPointDistance={nextPointDistance}
            destinationDistance={destinationDistance}
            relativeAngle={relativeAngle}
            cameraReady={cameraReady}
            destination={destination}
          />
          <YoloDanger cameraRef={cameraRef} permission={permission} isFocused={isFocused} />
          
          {!cameraReady && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#FF8C42" />
              <Text style={styles.loadingText}>카메라 초기화 중...</Text>
            </View>
          )}
        </CameraView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  camera: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  text: { color: '#FFFFFF', fontSize: 18, marginBottom: 5 },
  loadingContainer: { alignItems: 'center', marginTop: 10 },
  loadingText: { color: '#FFFFFF', fontSize: 14, marginTop: 10 },
  permissionButton: { marginTop: 20, backgroundColor: '#4FC3F7', padding: 15, borderRadius: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 16 },
});

export default GuideScreen;
