import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/alert_provider.dart';
import '../services/location_service.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  bool _permissionsGranted = false;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _checkPermissions();
  }

  Future<void> _checkPermissions() async {
    final granted = await LocationService.hasPermissions();
    if (mounted) setState(() => _permissionsGranted = granted);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  Future<void> _triggerSOS() async {
    HapticFeedback.heavyImpact();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Send SOS Alert?'),
        content: const Text(
          'This will immediately send your location to emergency contacts and nearby users. Continue?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('SEND SOS'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final alertProvider = context.read<AlertProvider>();
    final success = await alertProvider.triggerSOS();

    if (!mounted) return;
    if (success) {
      Navigator.pushNamed(context, '/cancel');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(alertProvider.error ?? 'Failed to send alert'),
          backgroundColor: Colors.red,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final alert = context.watch<AlertProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Emergency Alert'),
        actions: [
          IconButton(
            icon: const Icon(Icons.contacts),
            onPressed: () => Navigator.pushNamed(context, '/contacts'),
          ),
          IconButton(
            icon: const Icon(Icons.history),
            onPressed: () => Navigator.pushNamed(context, '/history'),
          ),
          PopupMenuButton(
            itemBuilder: (context) => [
              PopupMenuItem(
                onTap: () async {
                  await auth.logout();
                  if (context.mounted) {
                    Navigator.pushReplacementNamed(context, '/login');
                  }
                },
                child: const Text('Sign Out'),
              ),
            ],
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              // Status bar
              _StatusCard(
                permissionsGranted: _permissionsGranted,
                statusMessage: alert.statusMessage,
                userName: auth.user?.name ?? '',
              ),
              const Spacer(),

              // SOS Button
              GestureDetector(
                onTap: alert.sending ? null : _triggerSOS,
                child: AnimatedBuilder(
                  animation: _pulseController,
                  builder: (context, child) {
                    final scale = 1.0 + (_pulseController.value * 0.05);
                    return Transform.scale(
                      scale: alert.sending ? 1.0 : scale,
                      child: child,
                    );
                  },
                  child: Container(
                    width: 220,
                    height: 220,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: alert.sending ? Colors.grey : const Color(0xFFD32F2F),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.red.withValues(alpha: 0.4),
                          blurRadius: 30,
                          spreadRadius: 10,
                        ),
                      ],
                    ),
                    child: alert.sending
                        ? const Center(child: CircularProgressIndicator(color: Colors.white))
                        : const Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.emergency, size: 64, color: Colors.white),
                              SizedBox(height: 8),
                              Text(
                                'SOS',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 32,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 4,
                                ),
                              ),
                            ],
                          ),
                  ),
                ),
              ),

              const SizedBox(height: 24),
              Text(
                'Tap to send emergency alert',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Colors.grey),
              ),
              const Spacer(),

              // Quick actions
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => Navigator.pushNamed(context, '/contacts'),
                      icon: const Icon(Icons.people),
                      label: const Text('Contacts'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => Navigator.pushNamed(context, '/history'),
                      icon: const Icon(Icons.list_alt),
                      label: const Text('History'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  final bool permissionsGranted;
  final String? statusMessage;
  final String userName;

  const _StatusCard({
    required this.permissionsGranted,
    this.statusMessage,
    required this.userName,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  permissionsGranted ? Icons.check_circle : Icons.warning,
                  color: permissionsGranted ? Colors.green : Colors.orange,
                  size: 20,
                ),
                const SizedBox(width: 8),
                Text(
                  permissionsGranted ? 'Ready' : 'Permissions needed',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ],
            ),
            if (userName.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text('Signed in as $userName'),
            ],
            if (statusMessage != null) ...[
              const SizedBox(height: 8),
              Text(statusMessage!, style: TextStyle(color: Theme.of(context).colorScheme.primary)),
            ],
          ],
        ),
      ),
    );
  }
}
