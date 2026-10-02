// screens/navigation/RouteScreen.js
import React, { useEffect } from 'react';
import RouteMap from '../../components/navigation/RouteMap';
import { useRouteCalculation } from '../../hooks/navigation/useRouteCalculation';

const RouteScreen = ({ route, navigation }) => {
  const { currentLocation, destination, destinationCoords } = route.params;

  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: false,
    });
  }, [navigation]);

  const {
    duration,
    distance,
    isLoading,
    error
  } = useRouteCalculation({
    currentLocation,
    destination,
    destinationCoords,
    onRouteCalculated: ({ duration, distance, needsTransit }) => {
      if (needsTransit) {
        setTimeout(() => navigation.navigate('NavigationScreen'), 3500);
      }
    },
    onNavigationNeeded: () => navigation.navigate('NavigationScreen')
  });

  const handleCountdownEnd = () => {
    if (duration !== null && duration > 30) {
      navigation.navigate('MainTabs', { screen: 'Navigation' });
      return;
    }
    setTimeout(() => {
      navigation.navigate('Guide', {
        currentLocation,
        destination,
        destinationCoords,
        duration,
        distance,
      });
    }, 1000);
  };

  return (
    <RouteMap
      destination={destination}
      duration={duration}
      distance={distance}
      currentLocation={currentLocation}
      destinationCoords={destinationCoords}
      onCountdownEnd={handleCountdownEnd}
      error={error}
      isLoading={isLoading}
    />
  );
};

export default RouteScreen;