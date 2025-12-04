import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRunning } from '../providers/running_provider';

// 화면 전역에서 재사용할 저장소 키와 기본값 정의
const STORAGE_KEYS = {
  profile: 'settings_profile',
} as const;

// 기본 정보 상태 초기값
const DEFAULT_PROFILE = { name: '', gender: '', birth: '', height: '', weight: '' };

// 기본 정보 입력용 성별 옵션 목록
const GENDER_OPTIONS = ['남성', '여성', '기타'] as const;
type GenderOption = (typeof GENDER_OPTIONS)[number];

const SettingsScreen = () => {
  // 기본 정보 입력 상태 관리
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const { saveProfile, userProfile } = useRunning();

  // 생년월일 문자열을 Date 객체로 안전하게 변환
  const parsedBirth = useMemo(() => {
    if (!profile.birth) return new Date();
    const parsed = new Date(profile.birth);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [profile.birth]);

  // 저장된 설정 복원 및 Provider 프로필과 동기화
  useEffect(() => {
    const loadStoredProfile = async () => {
      try {
        const storedProfile = await AsyncStorage.getItem(STORAGE_KEYS.profile);
        if (storedProfile) {
          setProfile(JSON.parse(storedProfile));
        }
      } catch (error) {
        console.error('Storage load error:', error);
        Alert.alert('불러오기 실패', '저장된 설정을 불러오는 중 문제가 발생했습니다.');
      }
    };

    loadStoredProfile();
  }, []);

  // Provider에서 불러온 체중으로 빈 입력값을 채워줌
  useEffect(() => {
    if (userProfile?.weightKg && !profile.weight) {
      setProfile((prev) => ({ ...prev, weight: String(userProfile.weightKg) }));
    }
  }, [profile.weight, userProfile]);

  // 입력 값 변경 시 상태 반영 및 즉시 저장
  const handleChange = (key: keyof typeof profile, value: string) => {
    setProfile((prev) => {
      const updated = { ...prev, [key]: value };
      AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(updated)).catch((error) => {
        console.error('Storage save error:', error);
        Alert.alert('저장 실패', '설정을 저장하는 중 문제가 발생했습니다.');
      });
      return updated;
    });
  };

  // 생년월일 선택 시 플랫폼 별 기본 DatePicker 사용
  const handleBirthPick = () => {
    const onChange = (_event: DateTimePickerEvent, date?: Date) => {
      if (!date) return;
      const formatted = date.toISOString().slice(0, 10);
      handleChange('birth', formatted);
    };

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: parsedBirth,
        onChange,
        mode: 'date',
        is24Hour: true,
      });
    }
  };

  // 입력된 기본 정보를 저장하고 Provider의 체중 정보도 동기화
  const handleSaveProfile = async () => {
    const sanitizedProfile = {
      ...profile,
      height: profile.height.trim(),
      weight: profile.weight.trim(),
    };

    try {
      await AsyncStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(sanitizedProfile));
      await saveProfile({ weightKg: Number(sanitizedProfile.weight) });
      Alert.alert('저장 완료', '기본 정보가 저장되었습니다.');
    } catch (error) {
      console.error('Save profile error:', error);
      Alert.alert('저장 실패', '기본 정보를 저장하는 중 문제가 발생했습니다.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>설정</Text>
      <Text style={styles.subHeader}>기본 정보를 입력하면 앱을 재실행해도 저장됩니다.</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>기본 정보</Text>
        <LabeledInput
          label="이름"
          placeholder="홍길동"
          value={profile.name}
          onChangeText={(value) => handleChange('name', value)}
        />

        <Text style={styles.label}>성별</Text>
        <View style={styles.genderRow}>
          {GENDER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option}
              style={[styles.genderChip, profile.gender === option && styles.genderChipSelected]}
              onPress={() => handleChange('gender', option as GenderOption)}
            >
              <Text style={[styles.genderText, profile.gender === option && styles.genderTextSelected]}>{option}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>생년월일</Text>
        <TouchableOpacity style={styles.dateInput} onPress={handleBirthPick}>
          <Text style={profile.birth ? styles.dateValue : styles.placeholderText}>
            {profile.birth ? profile.birth : '날짜를 선택하세요'}
          </Text>
        </TouchableOpacity>

        <View style={styles.row}>
          <LabeledInput
            label="키(cm)"
            placeholder="175"
            value={profile.height}
            onChangeText={(value) => handleChange('height', value)}
            style={styles.halfInput}
            keyboardType="numeric"
          />
          <LabeledInput
            label="체중(kg)"
            placeholder="70"
            value={profile.weight}
            onChangeText={(value) => handleChange('weight', value)}
            style={styles.halfInput}
            keyboardType="numeric"
          />
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={handleSaveProfile}>
          <Text style={styles.saveButtonText}>프로필 저장</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const LabeledInput = ({ label, style, ...props }: any) => (
  <View style={[styles.inputGroup, style]}>
    <Text style={styles.label}>{label}</Text>
    <TextInput style={styles.input} {...props} />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f7f7' },
  content: { padding: 20, paddingBottom: 40 },
  header: { fontSize: 24, fontWeight: 'bold', color: '#333' },
  subHeader: { fontSize: 14, color: '#666', marginBottom: 12 },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  inputGroup: { marginBottom: 12, flex: 1 },
  label: { fontSize: 13, color: '#666', marginBottom: 6 },
  input: { backgroundColor: '#f2f2f2', borderRadius: 10, padding: 12, color: '#333' },
  placeholderText: { color: '#999' },
  halfInput: { flex: 1, marginRight: 8 },
  genderRow: { flexDirection: 'row', marginBottom: 12 },
  genderChip: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#f2f2f2',
    borderRadius: 10,
    alignItems: 'center',
    marginRight: 8,
  },
  genderChipSelected: { backgroundColor: '#5856D6' },
  genderText: { color: '#444', fontWeight: '600' },
  genderTextSelected: { color: '#fff' },
  dateInput: {
    backgroundColor: '#f2f2f2',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  dateValue: { color: '#333' },
  saveButton: {
    backgroundColor: '#5856D6',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonText: { color: '#fff', fontWeight: 'bold' },
});

export default SettingsScreen;
