declare module '@react-native-async-storage/async-storage' {
  interface AsyncStorageStatic {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
  }

  const AsyncStorage: AsyncStorageStatic;
  export default AsyncStorage;
}
