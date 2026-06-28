import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/alert_provider.dart';

class AlertHistoryScreen extends StatefulWidget {
  const AlertHistoryScreen({super.key});

  @override
  State<AlertHistoryScreen> createState() => _AlertHistoryScreenState();
}

class _AlertHistoryScreenState extends State<AlertHistoryScreen> {
  @override
  void initState() {
    super.initState();
    context.read<AlertProvider>().loadHistory();
  }

  Future<void> _openMap(double lat, double lng) async {
    final url = Uri.parse('https://maps.google.com/?q=$lat,$lng');
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final alerts = context.watch<AlertProvider>().history;
    final dateFormat = DateFormat('MMM d, yyyy HH:mm');

    return Scaffold(
      appBar: AppBar(title: const Text('Alert History')),
      body: alerts.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.history, size: 64, color: Colors.grey[600]),
                  const SizedBox(height: 16),
                  const Text('No alerts yet'),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: () => context.read<AlertProvider>().loadHistory(),
              child: ListView.builder(
                itemCount: alerts.length,
                itemBuilder: (context, index) {
                  final alert = alerts[index];
                  final isActive = alert.isActive;
                  final isCancelled = alert.status == 'cancelled';

                  return Card(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: isActive
                            ? Colors.red
                            : isCancelled
                                ? Colors.orange
                                : Colors.grey,
                        child: Icon(
                          isActive ? Icons.emergency : Icons.check,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                      title: Text(alert.alertType.toUpperCase()),
                      subtitle: Text(dateFormat.format(alert.createdAt)),
                      trailing: Chip(
                        label: Text(
                          alert.status,
                          style: const TextStyle(fontSize: 12),
                        ),
                        backgroundColor: isActive
                            ? Colors.red.withValues(alpha: 0.2)
                            : Colors.grey.withValues(alpha: 0.2),
                      ),
                      onTap: () => _openMap(alert.latitude, alert.longitude),
                    ),
                  );
                },
              ),
            ),
    );
  }
}
