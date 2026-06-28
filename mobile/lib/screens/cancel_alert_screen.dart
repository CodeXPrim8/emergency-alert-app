import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/alert_provider.dart';

class CancelAlertScreen extends StatefulWidget {
  const CancelAlertScreen({super.key});

  @override
  State<CancelAlertScreen> createState() => _CancelAlertScreenState();
}

class _CancelAlertScreenState extends State<CancelAlertScreen> {
  Timer? _timer;
  int _secondsRemaining = 30;

  @override
  void initState() {
    super.initState();
    final grace = context.read<AlertProvider>().cancelGraceSeconds;
    _secondsRemaining = grace;
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_secondsRemaining <= 0) {
        timer.cancel();
        _goHome();
        return;
      }
      setState(() => _secondsRemaining--);
    });
  }

  void _goHome() {
    if (mounted) Navigator.pushReplacementNamed(context, '/home');
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _cancelAlert() async {
    final alertProvider = context.read<AlertProvider>();
    final success = await alertProvider.cancelAlert();

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          success ? 'False alarm cancelled' : (alertProvider.error ?? 'Could not cancel'),
        ),
        backgroundColor: success ? Colors.green : Colors.red,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final alert = context.watch<AlertProvider>();

    return Scaffold(
      appBar: AppBar(title: const Text('Alert Sent')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.check_circle, color: Colors.green, size: 80),
              const SizedBox(height: 24),
              Text(
                'Emergency Alert Active',
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              Text(
                'Your location has been sent to emergency contacts and nearby users.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: Colors.grey),
              ),
              if (alert.activeAlert != null) ...[
                const SizedBox(height: 24),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        Text('Alert ID: ${alert.activeAlert!.id.substring(0, 8)}...'),
                        const SizedBox(height: 8),
                        Text(
                          'Location: ${alert.activeAlert!.latitude.toStringAsFixed(4)}, '
                          '${alert.activeAlert!.longitude.toStringAsFixed(4)}',
                        ),
                      ],
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 32),
              Text(
                'False alarm? Cancel within',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 8),
              Text(
                '$_secondsRemaining seconds',
                style: Theme.of(context).textTheme.displaySmall?.copyWith(
                      color: Theme.of(context).colorScheme.primary,
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: _secondsRemaining > 0 ? _cancelAlert : null,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    side: const BorderSide(color: Colors.orange),
                  ),
                  child: const Text('Cancel False Alarm'),
                ),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: () {
                  context.read<AlertProvider>().clearActiveAlert();
                  _goHome();
                },
                child: const Text('Keep alert active'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
