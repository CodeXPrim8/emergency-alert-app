class User {
  final String id;
  final String name;
  final String? phone;
  final String? email;
  final bool phoneVerified;
  final bool emailVerified;

  User({
    required this.id,
    required this.name,
    this.phone,
    this.email,
    this.phoneVerified = false,
    this.emailVerified = false,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      name: json['name'] as String,
      phone: json['phone'] as String?,
      email: json['email'] as String?,
      phoneVerified: json['phone_verified'] as bool? ?? json['phoneVerified'] as bool? ?? false,
      emailVerified: json['email_verified'] as bool? ?? json['emailVerified'] as bool? ?? false,
    );
  }
}

class EmergencyContact {
  final String id;
  final String name;
  final String? phone;
  final String? email;

  EmergencyContact({
    required this.id,
    required this.name,
    this.phone,
    this.email,
  });

  factory EmergencyContact.fromJson(Map<String, dynamic> json) {
    return EmergencyContact(
      id: json['id'] as String,
      name: json['name'] as String,
      phone: json['phone'] as String?,
      email: json['email'] as String?,
    );
  }
}

class Alert {
  final String id;
  final double latitude;
  final double longitude;
  final String alertType;
  final String status;
  final DateTime createdAt;
  final DateTime? cancelledAt;

  Alert({
    required this.id,
    required this.latitude,
    required this.longitude,
    required this.alertType,
    required this.status,
    required this.createdAt,
    this.cancelledAt,
  });

  factory Alert.fromJson(Map<String, dynamic> json) {
    return Alert(
      id: json['id'] as String,
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      alertType: json['alert_type'] as String? ?? json['alertType'] as String? ?? 'sos',
      status: json['status'] as String,
      createdAt: DateTime.parse(json['created_at'] as String? ?? json['createdAt'] as String),
      cancelledAt: json['cancelled_at'] != null
          ? DateTime.parse(json['cancelled_at'] as String)
          : null,
    );
  }

  bool get isActive => status == 'active';
}
