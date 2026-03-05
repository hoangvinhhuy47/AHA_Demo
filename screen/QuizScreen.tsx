/* eslint-disable react-native/no-inline-styles */
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import QuizResultCard, { QuizData } from './QuizComponents';
import Share from 'react-native-share';

const API_BASE =
  'https://apps-423888331483268.apps.fbsbx.com/br-compress-sandbox-instant-bundle/gzip/1987577714667015/34176557625323236/static/data/vi/data/';

export default function QuizScreen() {
  const nameAppRef = useRef('');
  const canvasRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quizData, setQuizData] = useState<QuizData | null>(null);

  async function fetchQuiz() {
    const trimmed = nameAppRef.current.trim();
    if (!trimmed) {
      setError('Vui lòng nhập tên app.');
      return;
    }

    setLoading(true);
    setError(null);
    setQuizData(null);

    try {
      const res = await fetch(`${API_BASE}${trimmed}.json`);
      if (!res.ok) throw new Error(`Lỗi ${res.status}`);
      const json: QuizData = await res.json();
      setQuizData(json);
    } catch (e: any) {
      setError(e?.message ?? 'Không thể tải dữ liệu.');
    } finally {
      setLoading(false);
    }
  }

  async function requestAndroidPermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const permission =
      Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function handleSave() {
    const snapshot = canvasRef.current?.makeImageSnapshot?.();
    if (!snapshot) {
      Alert.alert('Lỗi', 'Không thể chụp ảnh canvas.');
      return;
    }

    const hasPermission = await requestAndroidPermission();
    if (!hasPermission) {
      Alert.alert('Từ chối', 'Cần quyền truy cập thư viện ảnh.');
      return;
    }

    const base64 = snapshot.encodeToBase64();
    const filePath = `${RNFS.CachesDirectoryPath}/quiz_${Date.now()}.png`;
    await RNFS.writeFile(filePath, base64, 'base64');
    await CameraRoll.saveAsset(`file://${filePath}`, {
      type: 'photo',
      album: 'Quiz Results',
    });
    await RNFS.unlink(filePath);
    Alert.alert('Thành công ✅', 'Ảnh đã được lưu vào thư viện!');
  }
  async function handleShare() {
    const snapshot = canvasRef.current?.makeImageSnapshot?.();
    if (!snapshot) {
      Alert.alert('Lỗi', 'Không thể chụp ảnh canvas.');
      return;
    }

    const base64 = snapshot.encodeToBase64();
    const filePath = `${RNFS.CachesDirectoryPath}/quiz_share_${Date.now()}.png`;

    // Ghi file tạm vào cache
    await RNFS.writeFile(filePath, base64, 'base64');

    // Share file từ local
    await Share.open({
      url: `file://${filePath}`,
      type: 'image/png',
      failOnCancel: false,
    });

    // Giữ file trong cache — không xoá để share sheet có thể đọc
    // File sẽ tự bị dọn khi cache đầy
  }
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
    >
      <ScrollView
        contentContainerStyle={{
          alignItems: 'center',
          paddingVertical: 20,
          display: 'flex',
          gap: 20,
          flex: 1,
          width: '100%',
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Input + Button */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Nhập id app..."
            placeholderTextColor="#aaa"
            defaultValue=""
            onChangeText={v => {
              nameAppRef.current = v;
            }}
            onSubmitEditing={fetchQuiz}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={fetchQuiz}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Xem</Text>
            )}
          </TouchableOpacity>
        </View>

        {error && <Text style={styles.errorText}>{error}</Text>}

        {quizData && (
          <View style={{ width: '100%', gap: 16 }}>
            <QuizResultCard
              userName="Huy"
              jsonData={quizData}
              profileUri="https://firebasestorage.googleapis.com/v0/b/magic-swap-puzzle.firebasestorage.app/o/users%2FwZb37U8jQlMy8ojmI3Wn8oXmvqG2%2FwZb37U8jQlMy8ojmI3Wn8oXmvqG2_avatar.jpg?alt=media&token=524fda6f-a2f9-4a4b-b698-defea981ab9b"
              variantIndex={Math.floor(Math.random() * 44)}
              canvasRef={canvasRef}
            />
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>Lưu ảnh</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleShare}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}> Share ảnh</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    height: '100%',
    flex: 1,
    backgroundColor: 'white',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    display: 'flex',
    width: '100%',
  },
  inputRow: {
    flexDirection: 'row',
    padding: 16,
    gap: 10,
    width: '100%',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  input: {
    flex: 1,
    height: 46,
    width: '100%',
    borderWidth: 1.5,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  btn: {
    height: 46,
    paddingHorizontal: 20,
    backgroundColor: '#e30000',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 70,
  },
  btnDisabled: {
    backgroundColor: '#aaa',
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  errorText: {
    marginHorizontal: 16,
    marginTop: 8,
    color: '#e30000',
    fontSize: 13,
  },
  saveBtn: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#e30000',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.5,
    width: '100%',
    textAlign: 'center',
    display: 'flex',
  },
});
