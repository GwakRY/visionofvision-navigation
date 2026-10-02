const TMAP_API_KEY = process.env.EXPO_PUBLIC_TMAP_API_KEY;

export const fetchPedestrianRoute = async (startX, startY, endX, endY, startName = '출발지', endName = '도착지') => {
    const maxRetries = 3;
    let lastError;
  
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Tmap API 요청 시도 ${attempt}/${maxRetries}`);
        
        const res = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'appKey': TMAP_API_KEY, 
          },
          body: JSON.stringify({
            startX,
            startY,
            endX,
            endY,
            startName,
            endName,
            reqCoordType: 'WGS84GEO',
            resCoordType: 'WGS84GEO',
          }),
        });
  
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Tmap API 오류: ${res.status} - ${errorText}`);
        }
  
        const data = await res.json();
        
        // 응답 데이터 검증
        if (!data.features || data.features.length === 0) {
          throw new Error('경로 정보를 찾을 수 없습니다.');
        }
  
        console.log('Tmap API 요청 성공');
        return data;
      } catch (err) {
        lastError = err;
        console.error(`Tmap API 요청 실패 (시도 ${attempt}/${maxRetries}):`, err.message);
        
        if (attempt < maxRetries) {
          // 재시도 전 잠시 대기
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
  
    console.error('Tmap 경로 요청 최종 실패:', lastError.message);
    throw lastError;
  };
  
  // 주소를 좌표로 변환하는 함수 추가
  export const geocode = async (address) => {
    try {
      console.log('주소 검색 시작:', address);
      
      // 검색어 정리 (공백 제거, 특수문자 처리)
      const cleanAddress = address.trim().replace(/\s+/g, ' ');
      
      // Tmap POI 검색 API 사용
      const res = await fetch(
        `https://apis.openapi.sk.com/tmap/pois?version=1&searchKeyword=${encodeURIComponent(cleanAddress)}&count=10&searchType=all`,
        {
          method: 'GET',
          headers: {
            'appKey': TMAP_API_KEY,
            'Content-Type': 'application/json',
          },
        }
      );
  
      if (!res.ok) {
        const errorText = await res.text();
        console.error('API 응답 오류:', res.status, errorText);
        throw new Error(`주소 검색 API 오류: ${res.status} - ${errorText}`);
      }
  
      const data = await res.json();
      console.log('API 응답 데이터:', JSON.stringify(data, null, 2));
      
      if (data.searchPoiInfo && data.searchPoiInfo.pois && data.searchPoiInfo.pois.poi && data.searchPoiInfo.pois.poi.length > 0) {
        const firstResult = data.searchPoiInfo.pois.poi[0];
        console.log('첫 번째 검색 결과:', firstResult);
        
        return {
          latitude: parseFloat(firstResult.frontLat),
          longitude: parseFloat(firstResult.frontLon),
          name: firstResult.name,
          address: firstResult.address
        };
      } else {
        console.log('검색 결과 없음:', data);
        throw new Error('해당 주소를 찾을 수 없습니다.');
      }
    } catch (err) {
      console.error('주소 검색 실패:', err.message);
      throw err;
    }
  };
  
  // 주소 변환 함수 추가
  export const reverseGeocode = async (latitude, longitude) => {
    try {
      const res = await fetch(
        `https://apis.openapi.sk.com/tmap/geo/reversegeocoding?version=1&lat=${latitude}&lon=${longitude}&coordType=WGS84GEO`,
        {
          headers: {
            appKey: TMAP_API_KEY,
          },
        }
      );
  
      if (!res.ok) {
        throw new Error(`주소 변환 API 오류: ${res.status}`);
      }
  
      const data = await res.json();
      
      if (data.addressInfo && data.addressInfo.fullAddress) {
        return data.addressInfo.fullAddress;
      } else {
        throw new Error('주소 정보를 찾을 수 없습니다.');
      }
    } catch (err) {
      console.error('주소 변환 실패:', err.message);
      throw err;
    }
  };