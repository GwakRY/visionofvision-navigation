// utils/location.js
import * as Location from 'expo-location';

export const getCurrentLocation = async () => {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('위치 권한 거부됨');
  const loc = await Location.getCurrentPositionAsync({});
  return loc.coords;
};
