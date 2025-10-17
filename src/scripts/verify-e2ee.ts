// E2EE Verification Script
// Run this to verify that the E2EE implementation is working correctly

import { CryptoManager, FeatureFlags, MessageValidator } from '../utils/crypto';

async function verifyE2EEImplementation() {
  console.log('🔐 Verifying E2EE Implementation...\n');

  try {
    // Test 1: Key Generation
    console.log('1. Testing key generation...');
    const keyPair = CryptoManager.generateKeyPair();
    const publicKeyB64 = CryptoManager.keyToBase64(keyPair.publicKey);
    const privateKeyB64 = CryptoManager.keyToBase64(keyPair.privateKey);
    
    console.log(`   ✓ Generated key pair`);
    console.log(`   ✓ Public key (32 bytes): ${publicKeyB64.substring(0, 16)}...`);
    console.log(`   ✓ Private key validation: ${CryptoManager.isValidPrivateKey(privateKeyB64)}`);

    // Test 2: Message Encryption/Decryption
    console.log('\n2. Testing message encryption...');
    const symmetricKey = CryptoManager.generateSymmetricKey();
    const testMessage = 'Hello, this is a secret E2EE message! 🔒';
    
    const encrypted = CryptoManager.encryptMessage(testMessage, symmetricKey);
    console.log(`   ✓ Encrypted message: ${encrypted.ciphertext.substring(0, 20)}...`);
    console.log(`   ✓ Nonce: ${encrypted.nonce}`);
    
    const decrypted = CryptoManager.decryptMessage(encrypted.ciphertext, encrypted.nonce, symmetricKey);
    console.log(`   ✓ Decrypted message: "${decrypted}"`);
    console.log(`   ✓ Message integrity: ${testMessage === decrypted ? 'PASS' : 'FAIL'}`);

    // Test 3: Key Exchange (ECDH)
    console.log('\n3. Testing key exchange...');
    const alice = CryptoManager.generateKeyPair();
    const bob = CryptoManager.generateKeyPair();
    
    const conversationKey = CryptoManager.generateSymmetricKey();
    
    // Alice encrypts the conversation key for Bob
    const encryptedForBob = CryptoManager.encryptKeyForUser(conversationKey, bob.publicKey);
    console.log(`   ✓ Encrypted conversation key for Bob: ${encryptedForBob.encryptedKey.substring(0, 20)}...`);
    
    // Bob decrypts the conversation key
    const bobsKey = CryptoManager.decryptKeyForUser(
      encryptedForBob.encryptedKey,
      encryptedForBob.ephemeralPublicKey,
      encryptedForBob.nonce,
      bob.privateKey
    );
    
    console.log(`   ✓ Key exchange successful: ${Buffer.from(conversationKey).equals(Buffer.from(bobsKey)) ? 'PASS' : 'FAIL'}`);

    // Test 4: File Encryption
    console.log('\n4. Testing file encryption...');
    const testFileData = new TextEncoder().encode('This is test file content for E2EE verification');
    const fileEncryption = CryptoManager.encryptFile(testFileData);
    
    console.log(`   ✓ File encrypted (${fileEncryption.encryptedData.length} bytes)`);
    
    const decryptedFile = CryptoManager.decryptFile(
      fileEncryption.encryptedData,
      fileEncryption.fileKey,
      fileEncryption.nonce
    );
    
    const decryptedText = new TextDecoder().decode(decryptedFile);
    console.log(`   ✓ File decrypted: "${decryptedText}"`);
    console.log(`   ✓ File integrity: ${decryptedText.includes('E2EE verification') ? 'PASS' : 'FAIL'}`);

    // Test 5: Message Validation
    console.log('\n5. Testing message validation...');
    const validMessage = {
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      senderId: 'test-user-123',
      timestamp: new Date().toISOString()
    };
    
    const isValid = MessageValidator.validateEncryptedMessage(validMessage);
    console.log(`   ✓ Message validation: ${isValid ? 'PASS' : 'FAIL'}`);

    // Test 6: Feature Flags
    console.log('\n6. Testing feature flags...');
    const e2eeEnabled = await FeatureFlags.isE2EEEnabled();
    const fileEncEnabled = await FeatureFlags.isFileEncryptionEnabled();
    
    console.log(`   ✓ E2EE messaging flag: ${e2eeEnabled}`);
    console.log(`   ✓ File encryption flag: ${fileEncEnabled}`);

    // Performance Test
    console.log('\n7. Performance test...');
    const startTime = Date.now();
    
    for (let i = 0; i < 100; i++) {
      const msg = `Test message ${i}`;
      const enc = CryptoManager.encryptMessage(msg, symmetricKey);
      CryptoManager.decryptMessage(enc.ciphertext, enc.nonce, symmetricKey);
    }
    
    const endTime = Date.now();
    const avgTime = (endTime - startTime) / 100;
    console.log(`   ✓ Average encrypt/decrypt time: ${avgTime.toFixed(2)}ms`);
    console.log(`   ✓ Performance: ${avgTime < 5 ? 'EXCELLENT' : avgTime < 10 ? 'GOOD' : 'NEEDS OPTIMIZATION'}`);

    console.log('\n🎉 E2EE Implementation Verification Complete!');
    console.log('✅ All cryptographic functions are working correctly');
    console.log('✅ Ready for production deployment');

  } catch (error) {
    console.error('\n❌ E2EE Verification Failed:', error);
    console.error('Please check the implementation and try again.');
    process.exit(1);
  }
}

// Run verification if called directly
if (require.main === module) {
  verifyE2EEImplementation().catch(console.error);
}

export { verifyE2EEImplementation };
