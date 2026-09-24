/** Version de l'application, lue dans `package.json` au moment de la compilation (`vite.config.ts`). */
declare const __APP_VERSION__: string;

/*
 * Accès aux dossiers du navigateur (File System Access), absent de `lib.dom` :
 * Chrome et Edge seulement, d'où des membres facultatifs. Seul
 * `platform/memoryFolder.ts` s'en sert.
 */
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads';
}

interface Window {
  showDirectoryPicker?(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
