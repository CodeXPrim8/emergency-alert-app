import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:pointycastle/export.dart';
import 'package:asn1lib/asn1lib.dart';
import 'api_service.dart';

class EncryptionService {
  static String? _serverPublicKey;

  static Future<String> fetchServerPublicKey() async {
    if (_serverPublicKey != null) return _serverPublicKey!;
    final response = await ApiService.get('/auth/public-key');
    final data = ApiService.parseResponse(response);
    _serverPublicKey = data['publicKey'] as String;
    return _serverPublicKey!;
  }

  static Future<Map<String, dynamic>> encryptPayload(
    Map<String, dynamic> payload,
  ) async {
    final publicKeyPem = await fetchServerPublicKey();
    final publicKey = _parsePublicKey(publicKeyPem);

    // Generate AES-256 key and IV
    final aesKey = _secureRandomBytes(32);
    final iv = _secureRandomBytes(12);
    final nonce = _secureRandomBytes(16);
    final timestamp = DateTime.now().millisecondsSinceEpoch;

    final plaintext = jsonEncode(payload);
    final plaintextBytes = utf8.encode(plaintext);

    // AES-256-GCM encryption
    final gcm = GCMBlockCipher(AESEngine())
      ..init(
        true,
        AEADParameters(
          KeyParameter(aesKey),
          128,
          iv,
          Uint8List(0),
        ),
      );

    final ciphertextWithTag = gcm.process(Uint8List.fromList(plaintextBytes));
    final tagLength = 16;
    final ciphertext = ciphertextWithTag.sublist(0, ciphertextWithTag.length - tagLength);
    final authTag = ciphertextWithTag.sublist(ciphertextWithTag.length - tagLength);

    // RSA-OAEP encrypt AES key
    final rsaEngine = OAEPEncoding.withCustomDigest(() => SHA256Digest(), RSAEngine())
      ..init(true, PublicKeyParameter<RSAPublicKey>(publicKey));
    final encryptedKey = rsaEngine.process(aesKey);

    final ciphertextB64 = base64Encode(ciphertext);
    final signPayload = '$timestamp:${base64Encode(nonce)}:$ciphertextB64';

    // Sign with a device key (simplified: use hash as integrity check for MVP)
    final signature = base64Encode(
      SHA256Digest().process(utf8.encode(signPayload)),
    );

    return {
      'encryptedPayload': {
        'encryptedKey': base64Encode(encryptedKey),
        'iv': base64Encode(iv),
        'authTag': base64Encode(authTag),
        'ciphertext': ciphertextB64,
        'signature': signature,
        'timestamp': timestamp,
        'nonce': base64Encode(nonce),
      },
    };
  }

  static RSAPublicKey _parsePublicKey(String pem) {
    final lines = pem
        .replaceAll('-----BEGIN PUBLIC KEY-----', '')
        .replaceAll('-----END PUBLIC KEY-----', '')
        .replaceAll('\n', '')
        .replaceAll('\r', '');
    final bytes = base64Decode(lines);
    final asn1Parser = ASN1Parser(bytes);
    final topLevelSeq = asn1Parser.nextObject() as ASN1Sequence;
    final publicKeyBitString = topLevelSeq.elements![1] as ASN1BitString;
    final publicKeyAsn = ASN1Parser(publicKeyBitString.valueBytes());
    final publicKeySeq = publicKeyAsn.nextObject() as ASN1Sequence;
    final modulus = (publicKeySeq.elements![0] as ASN1Integer).valueAsBigInteger;
    final exponent = (publicKeySeq.elements![1] as ASN1Integer).valueAsBigInteger;
    return RSAPublicKey(modulus!, exponent!);
  }

  static Uint8List _secureRandomBytes(int length) {
    final random = Random.secure();
    return Uint8List.fromList(List.generate(length, (_) => random.nextInt(256)));
  }
}
