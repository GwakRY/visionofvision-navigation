// src/hooks/useNavigationGuide.js
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { getBearing, getDistanceFromLatLonInMeters, normalizeAngle } from '../../utils/navigation/navigationUtils';
import { fetchPedestrianRoute } from '../../utils/navigation/tmap';
import { speakWithOptions } from '../../utils/speechHelper';

export function useNavigationGuide({ currentLocation, destination, destinationCoords, onArrival }) {
  // 안내 상태
  const [pointDescription, setPointDescription] = useState('');
  const [guidePoints, setGuidePoints] = useState([]);
  const [announcedPoints, setAnnouncedPoints] = useState({});
  const [nextPointDistance, setNextPointDistance] = useState(null);
  const [destinationDistance, setDestinationDistance] = useState(null);
  const [navReady, setNavReady] = useState(false);

  // 헤딩(방위) 안내
  const [heading, setHeading] = useState(null);
  const [bearingToDestination, setBearingToDestination] = useState(null);
  const [relativeAngle, setRelativeAngle] = useState(null);
  
  // Refs
  const headingSubRef = useRef(null);
  const lastHeadingSpokenAtRef = useRef(0);
  const guidePointsRef = useRef([]);
  const announcedPointsRef = useRef({});
  const prevMinDistRef = useRef(null);
  const prevClosestPointRef = useRef(null);
  const isRecalculatingRef = useRef(false);

  // Sync refs with state
  useEffect(() => { guidePointsRef.current = guidePoints; }, [guidePoints]);
  useEffect(() => { announcedPointsRef.current = announcedPoints; }, [announcedPoints]);

  // 초기 경로 계산
  useEffect(() => {
    const fetchRouteOnce = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const data = await fetchPedestrianRoute(
          currentLocation.longitude,
          currentLocation.latitude,
          destinationCoords.longitude,
          destinationCoords.latitude,
          '출발지',
          destination || '도착지'
        );

        if (data && Array.isArray(data.features)) {
          const points = data.features
            .filter(f => f.geometry?.type === 'Point' && f.properties?.description)
            .map(f => ({
              description: f.properties.description,
              latitude: f.geometry.coordinates[1],
              longitude: f.geometry.coordinates[0],
            }));
          setGuidePoints(points);
        }
      } catch (e) {
        console.error('경로 요청 실패:', e);
      }
    };

    fetchRouteOnce();
  }, [currentLocation, destinationCoords, destination]);

  // 헤딩 구독
  useEffect(() => {
    const subscribeToHeading = async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (perm.status !== 'granted') return;

        headingSubRef.current = await Location.watchHeadingAsync(h => {
          const deg = (Number.isFinite(h.trueHeading) && h.trueHeading >= 0) 
            ? h.trueHeading 
            : h.magHeading;
          if (deg != null && !Number.isNaN(deg) && deg >= 0) setHeading(deg);
        });
      } catch (e) {
        console.error('헤딩 구독 실패:', e);
      }
    };

    subscribeToHeading();
    return () => {
      if (headingSubRef.current) {
        headingSubRef.current.remove();
        headingSubRef.current = null;
      }
    };
  }, []);

  // 포인트 도착 체크 및 안내
  useEffect(() => {
    let isMounted = true;
    const checkAndAnnouncePoints = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        
        const loc = await Location.getCurrentPositionAsync({});
        const coords = loc.coords;

        if (guidePointsRef.current.length > 0) {
          const unannouncedPoints = guidePointsRef.current.filter(
            p => !announcedPointsRef.current[`${p.latitude},${p.longitude}`]
          );

          if (unannouncedPoints.length > 0) {
            const dists = unannouncedPoints.map(p => 
              getDistanceFromLatLonInMeters(coords.latitude, coords.longitude, p.latitude, p.longitude)
            );
            let minDist = Math.min(...dists);
            let closestIdx = dists.findIndex(d => d === minDist);
            let closestPoint = unannouncedPoints[closestIdx];
            setNextPointDistance(Math.max(0, Math.round(minDist - 14)));

            // 경로 이탈 감지 및 재탐색
            if (
              prevMinDistRef.current !== null &&
              prevClosestPointRef.current !== null &&
              !isRecalculatingRef.current &&
              closestPoint.latitude === prevClosestPointRef.current.latitude &&
              closestPoint.longitude === prevClosestPointRef.current.longitude &&
              minDist - prevMinDistRef.current > 30
            ) {
              isRecalculatingRef.current = true;
              setPointDescription('경로를 이탈하였습니다. 경로를 재탐색합니다.');
              speakWithOptions('경로를 이탈하였습니다. 경로를 재탐색합니다.');

              try {
                const data = await fetchPedestrianRoute(
                  coords.longitude,
                  coords.latitude,
                  destinationCoords.longitude,
                  destinationCoords.latitude,
                  '출발지',
                  destination || '도착지'
                );

                if (data && Array.isArray(data.features)) {
                  const points = data.features
                    .filter(f => f.geometry?.type === 'Point' && f.properties?.description)
                    .map(f => ({
                      description: f.properties.description,
                      latitude: f.geometry.coordinates[1],
                      longitude: f.geometry.coordinates[0],
                    }));
                  setGuidePoints(points);
                  setAnnouncedPoints({});
                  prevMinDistRef.current = null;
                  prevClosestPointRef.current = null;
                }
              } catch (e) {
                console.error('[경로 재탐색 실패]', e);
              } finally {
                isRecalculatingRef.current = false;
              }
              return;
            }

            prevMinDistRef.current = minDist;
            prevClosestPointRef.current = closestPoint;
          } else {
            setNextPointDistance(null);
          }

          // 포인트 도착 안내
          for (const point of guidePointsRef.current) {
            const key = `${point.latitude},${point.longitude}`;
            if (!announcedPointsRef.current[key]) {
              const dist = getDistanceFromLatLonInMeters(
                coords.latitude,
                coords.longitude,
                point.latitude,
                point.longitude
              );
              if (dist <= 15) {
                setPointDescription(point.description);
                speakWithOptions(point.description);

                setAnnouncedPoints(prev => ({ ...prev, [key]: true }));

                if (point.description.includes('도착')) {
                  onArrival?.();
                  return;
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('위치 전송 실패:', e);
      }
    };

    const updateDistances = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        
        const loc = await Location.getCurrentPositionAsync({});
        const coords = loc.coords;

        if (destinationCoords) {
          const destDist = getDistanceFromLatLonInMeters(
            coords.latitude,
            coords.longitude,
            destinationCoords.latitude,
            destinationCoords.longitude
          );
          setDestinationDistance(Math.round(destDist));

          const bearing = getBearing(
            coords.latitude,
            coords.longitude,
            destinationCoords.latitude,
            destinationCoords.longitude
          );
          setBearingToDestination(bearing);
        }

        if (guidePointsRef.current.length > 0) {
          const unannouncedPoints = guidePointsRef.current.filter(
            p => !announcedPointsRef.current[`${p.latitude},${p.longitude}`]
          );
          if (unannouncedPoints.length > 0) {
            const dists = unannouncedPoints.map(p =>
              getDistanceFromLatLonInMeters(coords.latitude, coords.longitude, p.latitude, p.longitude)
            );
            let minDist = Math.min(...dists);
            setNextPointDistance(Math.max(0, Math.round(minDist - 14)));
          } else {
            setNextPointDistance(null);
          }
        }
      } catch (e) {
        console.error('거리 업데이트 실패:', e);
      }
    };

    const intervalId = setInterval(() => {
      if (isMounted) checkAndAnnouncePoints();
    }, 5000);

    const distanceIntervalId = setInterval(() => {
      if (isMounted) updateDistances();
    }, 1000);

    checkAndAnnouncePoints();
    updateDistances();

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      clearInterval(distanceIntervalId);
    };
  }, [destinationCoords, destination, onArrival]);

  // 헤딩 → 상대각 계산
  useEffect(() => {
    if (heading == null || bearingToDestination == null) return;
    const rel = normalizeAngle(bearingToDestination - heading);
    setRelativeAngle(rel);
  }, [heading, bearingToDestination]);

  // navReady 상태 업데이트
  useEffect(() => {
    if (pointDescription && nextPointDistance !== null && destinationDistance !== null) {
      setNavReady(true);
    }
  }, [pointDescription, nextPointDistance, destinationDistance]);

  return {
    pointDescription,
    nextPointDistance,
    destinationDistance,
    relativeAngle,
    navReady,
  };
}
