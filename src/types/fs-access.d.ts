// File System Access API members that TypeScript's DOM lib does not declare yet (Chromium, Edge).
// Ambient global script: no imports or exports, so these interfaces merge with lib.dom.
// The lib already declares FileSystemDirectoryHandle.values() and its async iterator.

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  /** Remembers the chosen folder per id, so the picker opens in the same place next time. */
  id?: string;
  mode?: 'read' | 'readwrite';
}

interface Window {
  /** Undefined where unsupported (Firefox, Safari). Secure contexts only. */
  showDirectoryPicker?: (options?: DirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
}
