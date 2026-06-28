import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';
import '../models/models.dart';
import '../services/api_service.dart';
import '../services/encryption_service.dart';
import '../services/location_service.dart';

class AlertProvider extends ChangeNotifier {
  Alert? _activeAlert;
  List<Alert> _history = [];
  bool _sending = false;
  String? _error;
  String? _statusMessage;
  int _cancelGraceSeconds = 30;

  Alert? get activeAlert => _activeAlert;
  List<Alert> get history => _history;
  bool get sending => _sending;
  String? get error => _error;
  String? get statusMessage => _statusMessage;
  int get cancelGraceSeconds => _cancelGraceSeconds;

  Future<bool> triggerSOS() async {
    _sending = true;
    _error = null;
    _statusMessage = 'Getting your location...';
    notifyListeners();

    try {
      final position = await LocationService.getCurrentPosition();
      _statusMessage = 'Encrypting and sending alert...';
      notifyListeners();

      final payload = {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'alertType': 'sos',
        'deviceId': const Uuid().v4(),
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      };

      Map<String, dynamic> requestBody;
      try {
        requestBody = await EncryptionService.encryptPayload(payload);
      } catch (_) {
        // Fallback to unencrypted in dev if encryption fails
        requestBody = payload;
      }

      final response = await ApiService.post('/emergency', requestBody, auth: true);
      final data = ApiService.parseResponse(response);

      final alertJson = data['alert'] as Map<String, dynamic>;
      _activeAlert = Alert.fromJson(alertJson);
      _cancelGraceSeconds = data['cancelGraceSeconds'] as int? ?? 30;
      _statusMessage = 'Alert sent! ${_activeAlert!.id.substring(0, 8)}...';
      _sending = false;
      notifyListeners();
      return true;
    } on LocationException catch (e) {
      _error = e.message;
      _statusMessage = null;
      _sending = false;
      notifyListeners();
      return false;
    } on ApiException catch (e) {
      _error = e.message;
      _statusMessage = null;
      _sending = false;
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Failed to send alert: $e';
      _statusMessage = null;
      _sending = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> cancelAlert() async {
    if (_activeAlert == null) return false;

    try {
      final response = await ApiService.post(
        '/emergency/${_activeAlert!.id}/cancel',
        {},
        auth: true,
      );
      ApiService.parseResponse(response);
      _activeAlert = null;
      _statusMessage = 'Alert cancelled';
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      _error = e.message;
      notifyListeners();
      return false;
    }
  }

  Future<void> loadHistory() async {
    try {
      final response = await ApiService.get('/emergency', auth: true);
      final data = ApiService.parseResponse(response);
      _history = (data['alerts'] as List)
          .map((a) => Alert.fromJson(a as Map<String, dynamic>))
          .toList();
      notifyListeners();
    } catch (_) {}
  }

  void clearActiveAlert() {
    _activeAlert = null;
    _statusMessage = null;
    notifyListeners();
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
