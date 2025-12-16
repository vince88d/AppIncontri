import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { db } from '@/lib/firebase';

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
};

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80';

export default function ProfileDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [viewPhotoVisible, setViewPhotoVisible] = useState(false);

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
          setPhotos(data.photos ?? (data.photo ? [data.photo] : []));
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

  const isOwner = user?.uid === profile?.id;
  const originalPhotos = useMemo(
    () => (profile ? profile.photos ?? (profile.photo ? [profile.photo] : []) : []),
    [profile]
  );
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

  const chatId = useMemo(() => {
    if (!user?.uid || !profile?.id) return null;
    return [user.uid, profile.id].sort().join('_');
  }, [user?.uid, profile?.id]);

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
        const unique = [];
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
      await updateDoc(doc(db, 'profiles', profile.id), {
        name: name.trim(),
        age: ageNum,
        city: city.trim(),
        bio: bio.trim(),
        jobTitle: jobTitle.trim(),
        photo: photos[0] ?? profile.photo ?? '',
        photos,
        role: role.trim(),
        intent: intent.trim(),
        interests: userInterests,
      });
      setIsEditing(false);
      Alert.alert('Salvato!', 'Profilo aggiornato con successo!');
    } catch (e) {
      Alert.alert('Errore', 'Non sono riuscito a salvare. Riprova.');
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
          setPhotos((prev) => {
            const next = prev.filter((p) => p !== uri);
            // Se abbiamo rimosso la principale, la nuova principale sarà la prima rimasta
            return next;
          });
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
      setPhotos(profile.photos ?? (profile.photo ? [profile.photo] : []));
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

  const galleryPhotos =
    photos.length > 0 ? photos : profile.photo ? [profile.photo] : [];
  const primaryPhotoUri = galleryPhotos[0] ?? FALLBACK_PHOTO;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.headerButton} onPress={handleGoBack}>
          <Ionicons name="chevron-back" size={24} color={palette.text} />
        </Pressable>
        
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isOwner ? (isEditing ? 'Modifica Profilo' : 'Il Tuo Profilo') : 'Profilo'}
          </Text>
          {isOwner && !isEditing && (
            <Text style={styles.headerSubtitle}>Tocca l'icona della matita per modificare</Text>
          )}
        </View>

        {isOwner ? (
          <View style={styles.headerActions}>
            {isEditing ? (
              <Pressable style={[styles.headerButton, styles.cancelButton]} onPress={handleCancelEdit}>
                <Ionicons name="close" size={22} color="#ff3b30" />
              </Pressable>
            ) : (
              <Pressable style={[styles.headerButton, styles.editButton]} onPress={() => setIsEditing(true)}>
                <Ionicons name="create-outline" size={22} color={palette.tint} />
              </Pressable>
            )}
          </View>
        ) : (
          <View style={styles.headerButton} />
        )}
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={styles.content}
      >
        {/* Hero Section */}
        <View style={styles.heroContainer}>
          <Image
            source={{ uri: primaryPhotoUri }}
            style={styles.heroImage}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
          <View style={styles.heroOverlay} />
          <View style={styles.heroContent}>
            <View style={styles.heroTextContainer}>
              <Text style={styles.heroName}>
                {name || profile.name}, {age || profile.age}
              </Text>
              <View style={styles.heroMetaRow}>
                <View style={styles.metaItem}>
                  <Ionicons name="location" size={14} color="#fff" />
                  <Text style={styles.heroMeta}>{city || profile.city}</Text>
                </View>
                {jobTitle && (
                  <View style={styles.metaItem}>
                    <Ionicons name="briefcase" size={14} color="#fff" />
                    <Text style={styles.heroMeta}>{jobTitle}</Text>
                  </View>
                )}
              </View>
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
              {galleryPhotos.map((uri, index) => (
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
              ))}
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
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Preferenze</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="flash" size={18} color={palette.muted} />
                <Text style={styles.infoLabel}>Ruolo</Text>
              </View>
              {isOwner && isEditing ? (
                <View style={styles.chipsRow}>
                  {roleOptions.map((opt) => {
                    const selected = role === opt;
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
                        onPress={() => setRole(opt)}
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
              ) : (
                <Text style={[styles.infoValue, { color: palette.text }]}>
                  {role || profile.role || 'Non specificato'}
                </Text>
              )}
            </View>

            <View style={styles.infoRow}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="heart" size={18} color={palette.muted} />
                <Text style={styles.infoLabel}>Intento</Text>
              </View>
              {isOwner && isEditing ? (
                <View style={styles.chipsRow}>
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
              ) : (
                <Text style={[styles.infoValue, { color: palette.text }]}>
                  {intent || profile.intent || 'Non specificato'}
                </Text>
              )}
            </View>

            <View style={[styles.infoRow, { alignItems: 'flex-start' }]}>
              <View style={styles.infoLabelContainer}>
                <Ionicons name="sparkles" size={18} color={palette.muted} />
                <Text style={styles.infoLabel}>Interessi</Text>
              </View>
              {isOwner && isEditing ? (
                <View style={[styles.chipsRow, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
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
              ) : (
                <View style={[styles.chipsRow, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
                  {(userInterests.length ? userInterests : profile.interests || []).length ? (
                    (userInterests.length ? userInterests : profile.interests || []).map((opt) => (
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
                    ))
                  ) : (
                    <Text style={[styles.infoValue, { color: palette.muted }]}>
                      Nessun interesse indicato
                    </Text>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

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
            <View style={styles.infoRow}>
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
                  {city || profile.city}
                </Text>
              )}
            </View>

            {/* Professione */}
            <View style={styles.infoRow}>
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
                  {jobTitle || "Non specificato"}
                </Text>
              )}
            </View>
          </View>
        </View>

        {/* Bio Section */}
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
                {bio || "Nessuna bio disponibile"}
              </Text>
            )}
          </View>
        </View>

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

        {!isOwner && !isEditing && (
          <Pressable
            style={[styles.messageButton, { backgroundColor: palette.tint }]}
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
        )}

      </ScrollView>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    marginTop:30
  },
  headerButton: {
    padding: 8,
    borderRadius: 12,
  },
  editButton: {
    backgroundColor: 'rgba(0,122,255,0.1)',
  },
  cancelButton: {
    backgroundColor: 'rgba(255,59,48,0.1)',
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
    
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,    
  },
  headerSubtitle: {
    fontSize: 12,
    opacity: 0.6,
  },
  headerActions: {
    flexDirection: 'row',
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
  heroContainer: {
    height: 320,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
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
  infoLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  infoLabel: {
    fontSize: 16,
    fontWeight: '600',
    opacity: 0.8,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
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
  messageButtonText: {
    color: '#fff',
    fontSize: 16,
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
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
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
