import Voice from "@react-native-voice/voice";
import * as Speech from "expo-speech";

export const speakLines = (lines, options = {}) => {
  Speech.stop();
  lines.forEach((line) => Speech.speak(line, options));
};

export const speakWithOptions = (text, options = {}) => {
  Speech.stop();
  Speech.speak(text, options);
};

export const stopSpeech = () => {
  Speech.stop();
};

export const startSTT = async (onResult, onError) => {
  try {
    await Voice.stop();
    await Voice.start('ko-KR');

    Voice.onSpeechResults = (e) => {
      if (e.value && e.value[0]) {
        onResult(e.value[0]);
      }
    };

    Voice.onSpeechError = (e) => {
      console.error('음성 인식 오류:', e);
      if (onError) onError(e);
    };
  } catch (error) {
    console.error('STT 시작 오류:', error);
    if (onError) onError(error);
  }
};
