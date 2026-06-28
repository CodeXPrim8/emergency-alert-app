import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/notification_service.dart';

class AuthProvider extends ChangeNotifier {
  User? _user;
  bool _loading = false;
  String? _error;

  User? get user => _user;
  bool get loading => _loading;
  String? get error => _error;
  bool get isAuthenticated => _user != null;

  Future<bool> checkAuth() async {
    final token = await ApiService.getToken();
    if (token == null) return false;

    try {
      final response = await ApiService.get('/auth/me', auth: true);
      final data = ApiService.parseResponse(response);
      _user = User.fromJson(data['user'] as Map<String, dynamic>);
      notifyListeners();
      return true;
    } catch (_) {
      await ApiService.clearToken();
      return false;
    }
  }

  Future<bool> register({
    required String name,
    required String password,
    String? phone,
    String? email,
  }) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await ApiService.post('/auth/register', {
        'name': name,
        'password': password,
        if (phone != null && phone.isNotEmpty) 'phone': phone,
        if (email != null && email.isNotEmpty) 'email': email,
      });
      final data = ApiService.parseResponse(response);
      await ApiService.setToken(data['token'] as String);
      _user = User.fromJson(data['user'] as Map<String, dynamic>);
      await _registerDevice();
      _loading = false;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      _error = e.message;
      _loading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> login({String? phone, String? email, required String password}) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await ApiService.post('/auth/login', {
        if (phone != null) 'phone': phone,
        if (email != null) 'email': email,
        'password': password,
      });
      final data = ApiService.parseResponse(response);
      await ApiService.setToken(data['token'] as String);
      _user = User.fromJson(data['user'] as Map<String, dynamic>);
      await _registerDevice();
      _loading = false;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      _error = e.message;
      _loading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    await ApiService.clearToken();
    _user = null;
    notifyListeners();
  }

  Future<void> _registerDevice() async {
    final token = await NotificationService.getDeviceToken();
    if (token != null) {
      await ApiService.post('/auth/device', {
        'deviceToken': token,
        'deviceId': 'flutter-device',
      }, auth: true);
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
