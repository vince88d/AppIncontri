
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Alert } from 'react-native';

export function useAttachments(
  chatId: string | null,
  otherId: string,
  secretMode: boolean,
  handleSendMessage: (messageData: Partial<any>, isSecret: boolean) => Promise<void>
) {
  const [sendingImage, setSendingImage] = useState(false);
  const [sendingLocation, setSendingLocation] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [imageTimed, setImageTimed] = useState(false);

  const handleSendImage = async () => {
    if (!chatId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert('Permesso negato', 'Concedi accesso alle foto per inviare un\'immagine.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      base64: true,
      quality: 0.8,
      selectionLimit: 1,
    });
    if (result.canceled || !result.assets.length) return;
    const asset = result.assets[0];
    const dataUrl = asset.base64 && asset.type ? `data:${asset.type};base64,${asset.base64}` : asset.uri;
    setImageTimed(false);
    setPreviewImage(dataUrl);
    setPreviewVisible(true);
  };

  const sendImageMessage = async (dataUrl: string, timed: boolean) => {
    if (!chatId) return;
    setSendingImage(true);
    try {
      await handleSendMessage(
        {
          image: dataUrl,
        },
        timed || secretMode
      );
    } catch (e) {
      Alert.alert('Errore', 'Non sono riuscito a inviare la foto.');
    } finally {
      setSendingImage(false);
      setPreviewImage(null);
      setPreviewVisible(false);
      setImageTimed(false);
    }
  };

  const handleSendLocation = async () => {
    if (!chatId) return;
    if (sendingLocation) return;
    setSendingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permesso negato', 'Concedi accesso alla posizione per inviare la tua posizione.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      };
      await handleSendMessage(
        {
          location: coords,
        },
        secretMode
      );
    } catch (e) {
      Alert.alert('Errore', 'Non sono riuscito a inviare la posizione.');
    } finally {
      setSendingLocation(false);
    }
  };

  return {
    sendingImage,
    sendingLocation,
    previewImage,
    setPreviewImage,
    previewVisible,
    setPreviewVisible,
    imageTimed,
    setImageTimed,
    handleSendImage,
    sendImageMessage,
    handleSendLocation,
  };
}
