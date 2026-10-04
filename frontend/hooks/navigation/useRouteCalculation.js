// src/hooks/useRouteCalculation.js
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { fetchPedestrianRoute } from '../../utils/navigation/tmap';
import { speakWithOptions } from '../../utils/speechHelper';

export function useRouteCalculation({ 
  currentLocation, 
  destination, 
  destinationCoords,
  onRouteCalculated,
  onNavigationNeeded 
}) {
  const [duration, setDuration] = useState(null);
  const [distance, setDistance] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const getRoute = async () => {
      if (!currentLocation) {
        setError('현재 위치 정보가 없습니다.');
        setIsLoading(false);
        return;
      }

      if (!destinationCoords) {
        setError('목적지 좌표 정보가 없습니다.');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const endX = destinationCoords.longitude;
        const endY = destinationCoords.latitude;

        console.log('경로 요청 시작:', {
          start: `${currentLocation.longitude}, ${currentLocation.latitude}`,
          end: `${endX}, ${endY}`,
          destination
        });

        const result = await fetchPedestrianRoute(
          currentLocation.longitude,
          currentLocation.latitude,
          endX,
          endY,
          '현재 위치',
          destination
        );

        if (!result.features || result.features.length === 0) {
          throw new Error('경로를 찾을 수 없습니다.');
        }

        const { totalTime, totalDistance } = result.features[0].properties;
        const estimatedMinutes = Math.round(totalTime / 60);
        
        setDuration(estimatedMinutes);
        setDistance(totalDistance);

        if (estimatedMinutes > 30) {
          speakWithOptions(`예상 소요시간은 ${estimatedMinutes}분입니다. 대중교통 이용을 권장합니다. 이전 화면으로 돌아갑니다.`);
          onRouteCalculated?.({ duration: estimatedMinutes, distance: totalDistance, needsTransit: true });
        } else {
          speakWithOptions(`${destination}까지 안내를 시작합니다. 예상 소요시간은 ${estimatedMinutes}분입니다.`);
          onRouteCalculated?.({ duration: estimatedMinutes, distance: totalDistance, needsTransit: false });
        }

      } catch (err) {
        console.error('경로 요청 실패:', err);
        setError(err.message);
        speakWithOptions('경로를 불러오지 못했습니다. 다시 시도해 주세요.');
        
        Alert.alert(
          '경로 오류',
          err.message || '경로를 불러오지 못했습니다.',
          [
            { text: '뒤로 가기', onPress: onNavigationNeeded },
            { text: '다시 시도', onPress: () => getRoute() }
          ]
        );
      } finally {
        setIsLoading(false);
      }
    };

    getRoute();
  }, [currentLocation, destinationCoords, destination, onRouteCalculated, onNavigationNeeded]);

  return {
    duration,
    distance,
    isLoading,
    error,
  };
}
