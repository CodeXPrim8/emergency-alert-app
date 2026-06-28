class ApiConfig {
  // Uses the same host as the app — works for localhost and LAN IPs automatically
  static String get baseUrl {
    // For Flutter mobile, set your computer's LAN IP, e.g. http://192.168.1.100:3000
    const override = String.fromEnvironment('API_URL', defaultValue: '');
    if (override.isNotEmpty) return override;
    return 'http://10.0.2.2:3000'; // Android emulator default
  }
  static const String apiVersion = '/api/v1';
  static String get apiBase => '$baseUrl$apiVersion';
}
