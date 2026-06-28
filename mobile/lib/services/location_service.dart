import 'package:geolocator/geolocator.dart';
import 'package:permission_handler/permission_handler.dart';

class LocationService {
  static Future<bool> requestPermissions() async {
    final locationStatus = await Permission.location.request();
    final notificationStatus = await Permission.notification.request();

    // Background location on Android
    if (await Permission.locationAlways.isDenied) {
      await Permission.locationAlways.request();
    }

    return locationStatus.isGranted && notificationStatus.isGranted;
  }

  static Future<bool> hasPermissions() async {
    final location = await Permission.location.isGranted;
    final notification = await Permission.notification.isGranted;
    return location && notification;
  }

  static Future<Position> getCurrentPosition() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      throw LocationException('Location services are disabled');
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      throw LocationException('Location permission denied');
    }

    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
  }

  static String permissionRationale(String permission) {
    switch (permission) {
      case 'location':
        return 'Location access is required to send your position during an emergency alert so responders and trusted contacts can find you.';
      case 'background_location':
        return 'Background location allows the app to update your position even when not actively in use, improving emergency response accuracy.';
      case 'notification':
        return 'Notifications are required to receive emergency alerts from nearby users and confirm your SOS was sent.';
      default:
        return 'This permission is required for the app to function properly during emergencies.';
    }
  }
}

class LocationException implements Exception {
  final String message;
  LocationException(this.message);
  @override
  String toString() => message;
}
