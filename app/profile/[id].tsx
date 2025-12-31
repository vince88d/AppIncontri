import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { arrayRemove, arrayUnion, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';
import { uploadImageToStorage } from '@/lib/storage';

type Profile = {
  id: string;
  name: string;
  age: number;
  city: string;
  distanceKm: number;
  photo: string;
  photos?: string[];
  interests: string[];
  role?: string;
  intent?: string;
  bio?: string;
  jobTitle?: string;
  blocked?: string[];
  blockedBy?: string[];
};

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';
const TAP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const timestampToMs = (value: any) => {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (value.toMillis) return value.toMillis();
  if (value.toDate) return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
};

export default function ProfileDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [viewPhotoVisible, setViewPhotoVisible] = useState(false);
  const [myBlocked, setMyBlocked] = useState<string[]>([]);
  const [myBlockedBy, setMyBlockedBy] = useState<string[]>([]);
  const [myFavorites, setMyFavorites] = useState<string[]>([]);
  const [myInterested, setMyInterested] = useState<string[]>([]);
  const [tapCooldowns, setTapCooldowns] = useState<Record<string, any>>({});
  const [updatingFavorite, setUpdatingFavorite] = useState(false);
  const [updatingInterest, setUpdatingInterest] = useState(false);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [city, setCity] = useState('');
  const [bio, setBio] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [role, setRole] = useState('');
  const [intent, setIntent] = useState('');
  const [userInterests, setUserInterests] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!id) throw new Error('Nessun id');
        const snap = await getDoc(doc(db, 'profiles', id));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          setProfile({ id: snap.id, ...(data as any), interests: data.interests ?? [] });
          setName(data.name ?? '');
          setAge((data.age ?? '').toString());
          setCity(data.city ?? '');
          setBio(data.bio ?? '');
          setJobTitle(data.jobTitle ?? '');
            const nextPhotos = data.photos ?? (data.photo ? [data.photo] : []);
            setPhotos(nextPhotos);
          setRole(data.role ?? '');
          setIntent(data.intent ?? '');
          setUserInterests(Array.isArray(data.interests) ? data.interests : []);
        } else {
          setProfile(null);
          setError('Profilo non trovato');
        }
      } catch (e) {
        if (!active) return;
        setError('Errore nel caricamento');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!user?.uid) {
        setMyBlocked([]);
        setMyBlockedBy([]);
        setMyFavorites([]);
        setMyInterested([]);
        setTapCooldowns({});
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'profiles', user.uid));
        if (!active) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          setMyBlocked(Array.isArray(data.blocked) ? data.blocked : []);
          setMyBlockedBy(Array.isArray(data.blockedBy) ? data.blockedBy : []);
          setMyFavorites(Array.isArray(data.favorites) ? data.favorites : []);
          setMyInterested(Array.isArray(data.interested) ? data.interested : []);
          setTapCooldowns(
            data.tapCooldowns && typeof data.tapCooldowns === 'object' ? data.tapCooldowns : {}
          );
        } else {
          setMyBlocked([]);
          setMyBlockedBy([]);
          setMyFavorites([]);
          setMyInterested([]);
          setTapCooldowns({});
        }
      } catch (e) {
        if (!active) return;
        setMyBlocked([]);
        setMyBlockedBy([]);
        setMyFavorites([]);
        setMyInterested([]);
        setTapCooldowns({});
      }
      })();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const isOwner = user?.uid === profile?.id;
  const originalPhotos = useMemo(
    () => (profile ? profile.photos ?? (profile.photo ? [profile.photo] : []) : []),
    [profile]
  );
  const isBlockedView = useMemo(() => {
    if (!profile || !user?.uid || isOwner) return false;
    const blockedByTarget = Array.isArray(profile.blocked) && profile.blocked.includes(user.uid);
    const targetSaysNo = Array.isArray(profile.blockedBy) && profile.blockedBy.includes(user.uid);
    const iBlocked = myBlocked.includes(profile.id);
    const iAmBlockedBy = myBlockedBy.includes(profile.id);
    return blockedByTarget || targetSaysNo || iBlocked || iAmBlockedBy;
  }, [profile, user?.uid, isOwner, myBlocked, myBlockedBy]);
  const isFavorite = useMemo(
    () => !!profile?.id && myFavorites.includes(profile.id),
    [profile?.id, myFavorites]
  );
  const isInterested = useMemo(
    () => !!profile?.id && myInterested.includes(profile.id),
    [profile?.id, myInterested]
  );
  const tapCooldownUntilMs = useMemo(() => {
    if (!profile?.id) return null;
    const lastTapMs = timestampToMs(tapCooldowns[profile.id]);
    if (!lastTapMs) return null;
    return lastTapMs + TAP_COOLDOWN_MS;
  }, [profile?.id, tapCooldowns]);
  const tapCooldownRemainingMs = tapCooldownUntilMs ? tapCooldownUntilMs - Date.now() : 0;
  const isTapCooldownActive = !isOwner && tapCooldownRemainingMs > 0;
  const tapCooldownHours =
    tapCooldownRemainingMs > 0
      ? Math.max(1, Math.ceil(tapCooldownRemainingMs / (60 * 60 * 1000)))
      : 0;
  const hasUnsavedChanges = useMemo(() => {
    if (!profile) return false;
    const ageChanged = age.trim() !== String(profile.age ?? '');
    const photosChanged =
      photos.length !== originalPhotos.length ||
      photos.some((p, idx) => p !== originalPhotos[idx]);
    const interestsChanged =
      userInterests.length !== (profile.interests?.length ?? 0) ||
      userInterests.some((p, idx) => p !== (profile.interests?.[idx] ?? ''));
    return (
      name.trim() !== (profile.name ?? '') ||
      ageChanged ||
      city.trim() !== (profile.city ?? '') ||
      bio.trim() !== (profile.bio ?? '') ||
      jobTitle.trim() !== (profile.jobTitle ?? '') ||
      role.trim() !== (profile.role ?? '') ||
      intent.trim() !== (profile.intent ?? '') ||
      interestsChanged ||
      photosChanged
    );
  }, [profile, name, age, city, bio, jobTitle, role, intent, userInterests, photos, originalPhotos]);

  if (isBlockedView && !isOwner && !loading) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.loadingContainer}>
          <Ionicons name="lock-closed-outline" size={32} color={palette.muted} />
          <Text style={[styles.loadingText, { color: palette.muted }]}>
            Profilo non disponibile.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const chatId = useMemo(() => {
    if (!user?.uid || !profile?.id) return null;
    return [user.uid, profile.id].sort().join('_');
  }, [user?.uid, profile?.id]);

  const handleToggleFavorite = async () => {
    if (!user?.uid || !profile?.id || updatingFavorite) return;
    const targetId = profile.id;
    const nextValue = !isFavorite;
    setUpdatingFavorite(true);
    setMyFavorites((prev) =>
      nextValue ? [...prev, targetId] : prev.filter((id) => id !== targetId)
    );
    try {
      await updateDoc(doc(db, 'profiles', user.uid), {
        favorites: nextValue ? arrayUnion(targetId) : arrayRemove(targetId),
      });
    } catch (e) {
      setMyFavorites((prev) =>
        nextValue ? prev.filter((id) => id !== targetId) : [...prev, targetId]
      );
      Alert.alert('Errore', 'Non sono riuscito ad aggiornare i preferiti.');
    } finally {
      setUpdatingFavorite(false);
    }
  };

  const handleToggleInterest = async () => {
    if (!user?.uid || !profile?.id || updatingInterest) return;
    if (isTapCooldownActive) {
      Alert.alert('Attendi', `Puoi inviare un altro tap tra ${tapCooldownHours}h.`);
      return;
    }
    if (isInterested) {
      Alert.alert('Tap già inviato', 'Hai già inviato un tap a questo profilo.');
      return;
    }
    const targetId = profile.id;
    setUpdatingInterest(true);
    setMyInterested((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]));
    try {
      await updateDoc(doc(db, 'profiles', user.uid), {
        interested: arrayUnion(targetId),
        [`tapCooldowns.${targetId}`]: serverTimestamp(),
      });
      await updateDoc(doc(db, 'profiles', targetId), {
        interestedBy: arrayUnion(user.uid),
      });
    } catch (e) {
      setMyInterested((prev) => prev.filter((id) => id !== targetId));
      Alert.alert('Errore', 'Non sono riuscito a inviare il tap.');
    } finally {
      setUpdatingInterest(false);
    }
  };

  const roleOptions = ['Top', 'Vers', 'Bottom', 'NS'];
  const intentOptions = ['Relazione', 'Amicizia', 'Dating'];
  const interestOptions = [
    'Viaggi',
    'Sport',
    'Nightlife',
    'Cultura',
    'Tech',
    'Arte',
    'Foodie',
    'Nature',
    'Gaming',
  ];
  const roleIconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
    Top: 'arrow-up',
    Vers: 'swap-vertical',
    Bottom: 'arrow-down',
    NS: 'help-circle-outline',
  };

  const handlePickImage = async () => {
    if (!isOwner || !isEditing) {
      Alert.alert('Non autorizzato', 'Puoi modificare solo il tuo profilo quando sei in modalità modifica');
      return;
    }
    
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permesso negato', 'Concedi accesso alle foto per scegliere un immagine.');
      return;
    }
    
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: 3,
        base64: Platform.OS === 'web',
        copyToCacheDirectory: true,
      });
    
    if (!result.canceled) {
      const uris = result.assets
        .map((a) => {
          if (Platform.OS === 'web' && a.base64) {
            const mime = a.type ?? 'image/jpeg';
            return `data:${mime};base64,${a.base64}`;
          }
          return a.uri;
        })
        .filter(Boolean);
        setPhotos((prev) => {
          const merged = [...prev, ...uris];
          const seen = new Set<string>();
          const unique: string[] = [];
          for (const uri of merged) {
            if (!seen.has(uri)) {
              unique.push(uri);
              seen.add(uri);
            }
            if (unique.length >= 10) break;
          }
          return unique;
        });
    }
  };

  const handleSave = async () => {
    if (!profile || !isOwner || !isEditing) {
      Alert.alert('Non autorizzato', 'Puoi salvare solo il tuo profilo quando sei in modalità modifica');
      return;
    }
    
    const ageNum = Number(age);
      if (!name.trim() || Number.isNaN(ageNum) || ageNum < 18 || ageNum > 100) {
        Alert.alert('Controlla i campi', 'Inserisci nome e una età valida (18-100).');
        return;
      }
      
      setSaving(true);
      try {
        const sourcePhotos = photos.filter((uri) => !!uri && uri !== FALLBACK_PHOTO);
        const resolvedPhotos = sourcePhotos.length ? sourcePhotos : [];
        const nextPhotos: string[] = [];
        let skippedUploads = 0;
        for (let i = 0; i < resolvedPhotos.length; i += 1) {
          const uri = resolvedPhotos[i];
          if (uri.startsWith('http')) {
            nextPhotos.push(uri);
            continue;
          }
          if (Platform.OS === 'web' && (uri.startsWith('file://') || uri.startsWith('content://'))) {
            skippedUploads += 1;
            continue;
          }
          const path = `profile-images/${profile.id}/${Date.now()}-${i}`;
          try {
            const { url } = await uploadImageToStorage({
              uri,
              path,
              metadata: {
                kind: 'profile',
                profileId: profile.id,
                photoIndex: String(i),
              },
            });
            nextPhotos.push(url);
          } catch (uploadError) {
            console.error('Photo upload failed', uploadError);
            skippedUploads += 1;
          }
        }

        await updateDoc(doc(db, 'profiles', profile.id), {
          name: name.trim(),
          age: ageNum,
          city: city.trim(),
          bio: bio.trim(),
          jobTitle: jobTitle.trim(),
          photo: nextPhotos[0] ?? '',
          photos: nextPhotos,
          role: role.trim(),
          intent: intent.trim(),
          interests: userInterests,
        });
        setPhotos(nextPhotos);
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                photo: nextPhotos[0] ?? prev.photo,
                photos: nextPhotos,
              }
            : prev
        );
        setIsEditing(false);
        if (skippedUploads > 0) {
          Alert.alert(
            'Salvato con avviso',
            'Profilo aggiornato, ma alcune foto non sono state caricate.'
          );
        } else {
          Alert.alert('Salvato!', 'Profilo aggiornato con successo!');
        }
      } catch (e) {
        console.error('Save profile failed', e);
        const raw = e as { message?: string; code?: string };
        const detail = raw?.message ? ` ${raw.message}` : '';
        const code = raw?.code ? ` (${raw.code})` : '';
        Alert.alert('Errore', `Non sono riuscito a salvare${code}.${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePhoto = (uri: string) => {
    if (!isOwner || !isEditing) return;
    
    Alert.alert('Rimuovi foto', 'Vuoi eliminare questa foto?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Elimina',
        style: 'destructive',
          onPress: () => {
            setPhotos((prev) => prev.filter((p) => p !== uri));
          },
        },
      ]);
  };

  const handleSetPrimaryPhoto = (uri: string) => {
    if (!isOwner || !isEditing) return;
    setPhotos((prev) => {
      const filtered = prev.filter((p) => p !== uri);
      return [uri, ...filtered];
    });
  };

  const handleOpenPhoto = (uri: string) => {
    if (!uri) return;
    setViewPhoto(uri);
    setViewPhotoVisible(true);
  };

  const toggleInterest = (value: string) => {
    setUserInterests((prev) => {
      if (prev.includes(value)) {
        return prev.filter((v) => v !== value);
      }
      return [...prev, value];
    });
  };

  const handleAgeChange = (text: string) => {
    if (/^\d*$/.test(text)) {
      setAge(text);
    }
  };

  const handleGoBack = () => {
    if (isEditing && hasUnsavedChanges) {
      Alert.alert(
        'Modifiche non salvate',
        'Se esci ora perderai le modifiche al profilo.',
        [
          { text: 'Continua a modificare', style: 'cancel' },
          { text: 'Esci senza salvare', style: 'destructive', onPress: () => router.back() },
        ]
      );
      return;
    }
    router.back();
  };

  useEffect(() => {
    const onBackPress = () => {
      if (isEditing && hasUnsavedChanges) {
        handleGoBack();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [isEditing, hasUnsavedChanges]);

  const handleCancelEdit = () => {
    // Ripristina i valori originali
      if (profile) {
        setName(profile.name ?? '');
        setAge(profile.age ? String(profile.age) : '');
        setCity(profile.city ?? '');
        setBio(profile.bio ?? '');
        setJobTitle(profile.jobTitle ?? '');
        const resetPhotos = profile.photos ?? (profile.photo ? [profile.photo] : []);
        setPhotos(resetPhotos);
        setRole(profile.role ?? '');
        setIntent(profile.intent ?? '');
        setUserInterests(profile.interests ?? []);
      }
    setIsEditing(false);
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator color={palette.tint} />
          <Text style={styles.loadingText}>Carico profilo...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Profilo non trovato</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>Torna indietro</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const galleryPhotos = (photos.length > 0 ? photos : profile.photo ? [profile.photo] : [])
    .filter((uri) => !!uri && uri !== FALLBACK_PHOTO)
    .filter((uri) => {
      if (Platform.OS !== 'web') return true;
      return uri.startsWith('http') || uri.startsWith('data:');
    });
  const hasGalleryPhotos = galleryPhotos.length > 0;
  const primaryPhotoUri = hasGalleryPhotos ? galleryPhotos[0] : '';

  const showMessageButton = !isOwner && !isEditing;
  const interestLabel = isInterested
    ? 'Tap inviato'
    : isTapCooldownActive
    ? `Riprova tra ${tapCooldownHours}h`
    : 'Interessato';
  const isEditingView = isOwner && isEditing;
  const displayCity = (isEditingView ? city : city || profile.city || '').trim();
  const normalizedCity = displayCity.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const hasCity = !!displayCity && normalizedCity !== 'nd';
  const displayJobTitle = (isEditingView ? jobTitle : jobTitle || profile.jobTitle || '').trim();
  const hasJobTitle = !!displayJobTitle;
  const displayRole = (isEditingView ? role : role || profile.role || '').trim();
  const hasRole = !!displayRole;
  const roleIconName = roleIconMap[displayRole];
  const hasRoleIcon = !!roleIconName;
  const displayIntent = (isEditingView ? intent : intent || profile.intent || '').trim();
  const hasIntent = !!displayIntent;
  const displayBio = (isEditingView ? bio : bio || profile.bio || '').trim();
  const hasBio = !!displayBio;
  const displayInterests = (userInterests.length ? userInterests : profile.interests || []).filter(
    Boolean
  );
  const hasInterests = displayInterests.length > 0;
  const showPreferencesSection = isEditingView || hasRole || hasIntent || hasInterests;
  const showBioSection = isEditingView || hasBio;
  const showHeroMeta = hasCity || hasJobTitle;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: palette.background }]}
      edges={['top', 'left', 'right']}
    >

      <ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={[
          styles.content,
          showMessageButton && styles.contentWithStickyCta,
        ]}
      >
          {/* Hero Section */}
          <View style={styles.heroContainer}>
            <Pressable
              style={styles.heroPressable}
              onPress={() => handleOpenPhoto(primaryPhotoUri)}
              disabled={!hasGalleryPhotos}
            >
              {hasGalleryPhotos ? (
                <Image
                  source={{ uri: primaryPhotoUri }}
                  style={styles.heroImage}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                />
              ) : (
                <View style={[styles.heroPlaceholder, { backgroundColor: palette.card }]}>
                  <Ionicons name="image-outline" size={42} color={palette.muted} />
                  <Text style={[styles.heroPlaceholderText, { color: palette.muted }]}>
                    Nessuna foto
                  </Text>
                </View>
              )}
              {hasGalleryPhotos ? <View style={styles.heroOverlay} /> : null}
            </Pressable>
            <View style={[styles.heroTopActions, { top: 8 }]} pointerEvents="box-none">
              <Pressable style={styles.heroTopButton} onPress={handleGoBack}>
                <Ionicons name="chevron-back" size={22} color="#fff" />
              </Pressable>
              {isOwner ? (
                <Pressable
                  style={[
                    styles.heroTopButton,
                    isEditing ? styles.heroCancelButton : styles.heroEditButton,
                  ]}
                  onPress={isEditing ? handleCancelEdit : () => setIsEditing(true)}
                >
                  <Ionicons
                    name={isEditing ? 'close' : 'create-outline'}
                    size={20}
                    color="#fff"
                  />
                </Pressable>
              ) : (
                <View />
              )}
            </View>
            <View style={styles.heroContent}>
              <View style={styles.heroTextContainer}>
                <Text style={[styles.heroName, { color: hasGalleryPhotos ? '#fff' : palette.text }]}>
                  {name || profile.name}, {age || profile.age}
                </Text>
                {showHeroMeta && (
                  <View style={styles.heroMetaRow}>
                    {hasCity && (
                      <View style={styles.metaItem}>
                        <Ionicons
                          name="location"
                          size={14}
                          color={hasGalleryPhotos ? '#fff' : palette.muted}
                        />
                        <Text
                          style={[
                            styles.heroMeta,
                            { color: hasGalleryPhotos ? 'rgba(255,255,255,0.9)' : palette.muted },
                          ]}
                        >
                          {displayCity}
                        </Text>
                      </View>
                    )}
                    {hasJobTitle && (
                      <View style={styles.metaItem}>
                        <Ionicons
                          name="briefcase"
                          size={14}
                          color={hasGalleryPhotos ? '#fff' : palette.muted}
                        />
                        <Text
                          style={[
                            styles.heroMeta,
                            { color: hasGalleryPhotos ? 'rgba(255,255,255,0.9)' : palette.muted },
                          ]}
                        >
                          {displayJobTitle}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            </View>
        </View>

        {/* Edit Mode Banner */}
        {isOwner && isEditing && (
          <View style={[styles.editBanner, { backgroundColor: palette.tint }]}>
            <Ionicons name="information-circle" size={18} color="#fff" />
            <Text style={styles.editBannerText}>Modalità modifica attiva</Text>
          </View>
        )}

        {/* Photos Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Galleria Foto</Text>
            {isOwner && isEditing && galleryPhotos.length > 0 && (
              <Pressable style={styles.addButton} onPress={handlePickImage}>
                <Ionicons name="add" size={20} color={palette.tint} />
                <Text style={[styles.addButtonText, { color: palette.tint }]}>Aggiungi</Text>
              </Pressable>
            )}
          </View>
          
          {galleryPhotos.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photosStrip}
            >
              {galleryPhotos.map((uri, index) => {
                return (
                  <Pressable
                    key={uri}
                    style={styles.photoContainer}
                    onPress={() => handleOpenPhoto(uri)}
                  >
                    <Image
                      source={{ uri: uri || primaryPhotoUri }}
                      style={styles.photo}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    {isOwner && isEditing && (
                      <>
                        <Pressable
                          style={styles.removePhotoButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            handleRemovePhoto(uri);
                          }}
                        >
                          <Ionicons name="close" size={16} color="#fff" />
                        </Pressable>
                        {index > 0 && (
                          <Pressable
                            style={styles.setPrimaryButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              handleSetPrimaryPhoto(uri);
                            }}
                          >
                            <Ionicons name="star" size={14} color="#fff" />
                            <Text style={styles.setPrimaryText}>Principale</Text>
                          </Pressable>
                        )}
                      </>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : (
            <View style={styles.emptyPhotos}>
              <Ionicons name="images" size={48} color={palette.muted} />
              <Text style={[styles.emptyPhotosText, { color: palette.muted }]}>
                {isOwner 
                  ? isEditing 
                    ? "Aggiungi delle foto al tuo profilo" 
                    : "Nessuna foto nel tuo profilo"
                  : "Nessuna foto disponibile"
                }
              </Text>
              {isOwner && isEditing && (
                <Pressable style={[styles.addPhotoBtn, { backgroundColor: palette.tint }]} onPress={handlePickImage}>
                  <Text style={styles.addPhotoBtnText}>Aggiungi la prima foto</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* Preferenze */}
        {showPreferencesSection && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Preferenze</Text>

            <View style={styles.infoCard}>
            {isOwner && isEditing ? (
              <View style={styles.infoStack}>
                <View style={[styles.infoLabelContainer, styles.infoLabelContainerStack]}>
                  <Ionicons name="flash" size={18} color={palette.muted} />
                  <Text style={styles.infoLabel}>Ruolo</Text>
                </View>
                <View style={[styles.chipsRow, styles.chipsWrap]}>
                  {roleOptions.map((opt) => {
                    const selected = role === opt;
                    const iconName = roleIconMap[opt];
                    return (
                      <Pressable
                        key={opt}
                        style={[
                          styles.chip,
                          styles.chipRow,
                          {
                            borderColor: selected ? palette.tint : palette.border,
                            backgroundColor: selected ? `${palette.tint}20` : palette.card,
                          },
                        ]}
                        onPress={() => setRole(opt)}
                      >
                        {iconName ? (
                          <Ionicons
                            name={iconName}
                            size={14}
                            color={selected ? palette.tint : palette.text}
                          />
                        ) : null}
                        <Text
                          style={[
                            styles.chipText,
                            { color: selected ? palette.tint : palette.text },
                          ]}
                        >
                          {opt}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : hasRole ? (
              <View style={styles.infoRow}>
                <View style={styles.infoLabelContainer}>
                  <Ionicons name="flash" size={18} color={palette.muted} />
                  <Text style={styles.infoLabel}>Ruolo</Text>
                </View>
                <View style={styles.infoValueRow}>
                  {hasRoleIcon ? (
                    <Ionicons name={roleIconName} size={16} color={palette.text} />
                  ) : null}
                  <Text style={[styles.infoValue, styles.infoValueText, { color: palette.text }]}>
                    {displayRole}
                  </Text>
                </View>
              </View>
            ) : null}

            {isOwner && isEditing ? (
              <View style={styles.infoStack}>
                <View style={[styles.infoLabelContainer, styles.infoLabelContainerStack]}>
                  <Ionicons name="heart" size={18} color={palette.muted} />
                  <Text style={styles.infoLabel}>Intento</Text>
                </View>
                <View style={[styles.chipsRow, styles.chipsWrap]}>
                  {intentOptions.map((opt) => {
                    const selected = intent === opt;
                    return (
                      <Pressable
                        key={opt}
                        style={[
                          styles.chip,
                          {
                            borderColor: selected ? palette.tint : palette.border,
                            backgroundColor: selected ? `${palette.tint}20` : palette.card,
                          },
                        ]}
                        onPress={() => setIntent(opt)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: selected ? palette.tint : palette.text },
                          ]}
                        >
                          {opt}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : hasIntent ? (
              <View style={styles.infoRow}>
                <View style={styles.infoLabelContainer}>
                  <Ionicons name="heart" size={18} color={palette.muted} />
                  <Text style={styles.infoLabel}>Intento</Text>
                </View>
                <Text style={[styles.infoValue, { color: palette.text }]}>
                  {displayIntent}
                </Text>
              </View>
            ) : null}

            {isOwner && isEditing ? (
              <View style={styles.infoStack}>
                <View style={[styles.infoLabelContainer, styles.infoLabelContainerStack]}>
                  <Ionicons name="sparkles" size={18} color={palette.muted} />
                  <Text style={styles.infoLabel}>Interessi</Text>
                </View>
                <View style={[styles.chipsRow, styles.chipsWrap]}>
                  {interestOptions.map((opt) => {
                    const selected = userInterests.includes(opt);
                    return (
                      <Pressable
                        key={opt}
                        style={[
                          styles.chip,
                          {
                            borderColor: selected ? palette.tint : palette.border,
                            backgroundColor: selected ? `${palette.tint}20` : palette.card,
                            marginBottom: 8,
                          },
                        ]}
                        onPress={() => toggleInterest(opt)}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            { color: selected ? palette.tint : palette.text },
                          ]}
                        >
                          {opt}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : hasInterests ? (
              <View style={styles.infoStack}>
                <View style={[styles.infoLabelContainer, styles.infoLabelContainerStack]}>
                  <Ionicons name="sparkles" size={18} color={palette.muted} />
                  <Text style={styles.infoLabel}>Interessi</Text>
                </View>
                <View style={[styles.chipsRow, styles.chipsWrap, { width: '100%' }]}>
                  {displayInterests.map((opt) => (
                    <View
                      key={opt}
                      style={[
                        styles.chip,
                        {
                          borderColor: palette.border,
                          backgroundColor: palette.card,
                          marginBottom: 8,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: palette.text }]}>{opt}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
            </View>
          </View>
        )}

        {/* Informazioni Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Informazioni Personali</Text>
          
          <View style={styles.infoCard}>
            {/* Nome */}
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="person" size={18} color={palette.muted} />
                <Text style={styles.infoLabel}>Nome</Text>
              </View>
              {isOwner && isEditing ? (
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Il tuo nome"
                  style={[styles.textInput, { color: palette.text }]}
                  placeholderTextColor={palette.muted}
                />
              ) : (
                <Text style={[styles.infoValue, { color: palette.text }]}>
                  {name || profile.name}
                </Text>
              )}
            </View>

            {/* Età */}
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="calendar" size={18} color={palette.muted} />
                <Text style={styles.infoLabel}>Età</Text>
              </View>
              {isOwner && isEditing ? (
                <TextInput
                  value={age}
                  onChangeText={handleAgeChange}
                  placeholder="Età"
                  keyboardType="numeric"
                  style={[styles.textInput, { color: palette.text }]}
                  placeholderTextColor={palette.muted}
                  maxLength={3}
                />
              ) : (
                <Text style={[styles.infoValue, { color: palette.text }]}>
                  {age || profile.age} anni
                </Text>
              )}
            </View>

            {/* Città */}
            <View style={[styles.infoRow, !isEditingView && !hasCity && styles.hidden]}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="location" size={18} color={palette.muted} />
                <Text style={styles.infoLabel}>Città</Text>
              </View>
              {isOwner && isEditing ? (
                <TextInput
                  value={city}
                  onChangeText={setCity}
                  placeholder="La tua città"
                  style={[styles.textInput, { color: palette.text }]}
                  placeholderTextColor={palette.muted}
                />
              ) : (
                <Text style={[styles.infoValue, { color: palette.text }]}>
                  {displayCity}
                </Text>
              )}
            </View>

            {/* Professione */}
            <View style={[styles.infoRow, !isEditingView && !hasJobTitle && styles.hidden]}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="briefcase" size={18} color={palette.muted} />
                <Text style={styles.infoLabel}>Professione</Text>
              </View>
              {isOwner && isEditing ? (
                <TextInput
                  value={jobTitle}
                  onChangeText={setJobTitle}
                  placeholder="La tua professione"
                  style={[styles.textInput, { color: palette.text }]}
                  placeholderTextColor={palette.muted}
                />
              ) : (
                <Text style={[styles.infoValue, { color: palette.text }]}>
                  {displayJobTitle}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Bio Section */}
        {showBioSection && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Bio</Text>
              {isOwner && isEditing && (
                <Text style={[styles.charCount, { color: palette.muted }]}>
                  {bio.length}/500
                </Text>
              )}
            </View>
            <View style={styles.bioCard}>
              {isOwner && isEditing ? (
                <TextInput
                  value={bio}
                  onChangeText={setBio}
                  placeholder="Racconta qualcosa su di te... (max 500 caratteri)"
                  multiline
                  style={[styles.bioInput, { color: palette.text }]}
                  placeholderTextColor={palette.muted}
                  textAlignVertical="top"
                  maxLength={500}
                />
              ) : (
                <Text style={[styles.bioText, { color: palette.text }]}>
                  {displayBio}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Azioni finali */}
        {isOwner && isEditing && (
          <View style={styles.footerActions}>
            <Pressable
              style={[styles.cancelBtn, { borderColor: palette.muted }]}
              onPress={handleCancelEdit}
              disabled={saving}
            >
              <Text style={[styles.cancelBtnText, { color: palette.muted }]}>Annulla</Text>
            </Pressable>
            
            <Pressable
              style={[styles.saveButton, { backgroundColor: palette.tint }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="checkmark" size={22} color="#fff" />
              )}
              <Text style={styles.saveButtonText}>
                {saving ? 'Salvataggio...' : 'Salva Modifiche'}
              </Text>
            </Pressable>
          </View>
        )}

      </ScrollView>

      {showMessageButton && (
        <View
          style={[
            styles.stickyCta,
            {
              backgroundColor: palette.background,
              borderTopColor: palette.border,
              paddingBottom: Math.max(insets.bottom, 8) + 8,
            },
          ]}
        >
          <View style={styles.ctaActionsRow}>
            <Pressable
              style={[
                styles.ctaAction,
                {
                  borderColor: palette.border,
                  backgroundColor: isInterested
                    ? `${palette.tint}18`
                    : isTapCooldownActive
                    ? `${palette.border}66`
                    : palette.card,
                },
              ]}
              onPress={handleToggleInterest}
              disabled={updatingInterest || isInterested || isTapCooldownActive}
            >
              <Ionicons
                name={isInterested ? 'heart' : 'heart-outline'}
                size={18}
                color={isInterested ? palette.tint : isTapCooldownActive ? palette.muted : palette.text}
              />
              <Text
                style={[
                  styles.ctaActionText,
                  { color: isInterested ? palette.tint : isTapCooldownActive ? palette.muted : palette.text },
                ]}
              >
                {interestLabel}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.ctaAction,
                {
                  borderColor: palette.border,
                  backgroundColor: isFavorite ? `${palette.accent}18` : palette.card,
                },
              ]}
              onPress={handleToggleFavorite}
              disabled={updatingFavorite}
            >
              <Ionicons
                name={isFavorite ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={isFavorite ? palette.accent : palette.text}
              />
              <Text
                style={[
                  styles.ctaActionText,
                  { color: isFavorite ? palette.accent : palette.text },
                ]}
              >
                Preferiti
              </Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.messageButton, styles.messageButtonSticky, { backgroundColor: palette.tint }]}
            onPress={() =>
              router.push({
                pathname: `/messages/${profile.id}`,
                params: { name: profile.name, photo: primaryPhotoUri },
              })
            }
          >
            <Ionicons name="chatbubbles" size={18} color="#fff" />
            <Text style={styles.messageButtonText}>Messaggia</Text>
          </Pressable>
        </View>
      )}

      <Modal
        visible={viewPhotoVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setViewPhotoVisible(false);
          setViewPhoto(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          {viewPhoto ? (
            <Image source={{ uri: viewPhoto }} style={styles.modalImage} contentFit="contain" />
          ) : null}

          <View style={styles.modalHeader}>
            <Pressable
              style={[styles.modalButton, styles.closeButton]}
              onPress={() => {
                setViewPhotoVisible(false);
                setViewPhoto(null);
              }}
            >
              <Ionicons name="close" size={24} color="#fff" />
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '500',
  },
  content: {
    paddingBottom: 30,
  },
  contentWithStickyCta: {
    paddingBottom: 170,
  },
  heroContainer: {
    height: 340,
    position: 'relative',
  },
  heroPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  heroPlaceholderText: {
    fontSize: 14,
    fontWeight: '600',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroTopActions: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroTopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEditButton: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  heroCancelButton: {
    backgroundColor: 'rgba(255,59,48,0.7)',
  },
  heroContent: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
  },
  heroTextContainer: {
    gap: 8,
  },
  heroName: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  heroMetaRow: {
    flexDirection: 'row',
    gap: 16,
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroMeta: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    fontWeight: '500',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  editBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  editBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  charCount: {
    fontSize: 12,
    fontWeight: '500',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,122,255,0.1)',
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  photosStrip: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 4,
    paddingRight: 6,
  },
  photoContainer: {
    width: 140,
    aspectRatio: 3/4,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  removePhotoButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  setPrimaryButton: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  setPrimaryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyPhotos: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 16,
  },
  emptyPhotosText: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '500',
  },
  addPhotoBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  addPhotoBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoCard: {
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 16,
    padding: 20,
    gap: 20,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hidden: {
    display: 'none',
  },
  infoLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: 96,
  },
  infoLabel: {
    fontSize: 16,
    fontWeight: '600',
    opacity: 0.8,
  },
  infoValueRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  infoValueText: {
    flex: 0,
  },
  infoStack: {
    gap: 10,
  },
  infoLabelContainerStack: {
    flex: 0,
    width: '100%',
  },
  textInput: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    padding: 0,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  bioCard: {
    backgroundColor: 'rgba(0,0,0,0.02)',
    borderRadius: 16,
    padding: 20,
    minHeight: 120,
  },
  bioInput: {
    fontSize: 16,
    lineHeight: 22,
    padding: 0,
  },
  bioText: {
    fontSize: 16,
    lineHeight: 22,
  },
  footerActions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 24,
  },
  saveButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  messageButtonSticky: {
    marginHorizontal: 0,
    marginTop: 0,
  },
  messageButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  stickyCta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  ctaActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  ctaAction: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaActionText: {
    fontSize: 14,
    fontWeight: '700',
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 2,
  },
  cancelBtnText: {
    fontSize: 17,
    fontWeight: '600',
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  chipsWrap: {
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
  },
  notFoundText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  backText: {
    fontWeight: '600',
    fontSize: 16,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalImage: {
    width: '100%',
    height: '80%',
  },
  modalHeader: {
    position: 'absolute',
    top: 40,
    right: 20,
    left: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
});
