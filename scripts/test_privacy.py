import unittest
from audit_privacy import inspect

class PrivacyChecks(unittest.TestCase):
    def check_text(self,text):return inspect('sample.md',text.encode('utf8'))
    def test_personal_paths(self):
        self.assertIn('absolute home path',self.check_text('C:'+chr(92)+'Users'+chr(92)+'private'+chr(92)+'file.txt'))
        self.assertIn('absolute home path',self.check_text('/'+'home'+'/private/file.txt'))
    def test_secrets(self):
        self.assertIn('GitHub token',self.check_text('ghp'+'_'+'a'*36))
        self.assertIn('private key',self.check_text('-----BEGIN '+'PRIVATE KEY-----'))
    def test_actual_identifiers_and_email(self):
        self.assertIn('non-fixture long numeric identifier',self.check_text('7'*19))
        self.assertIn('email address',self.check_text('private'+'@'+'mail.example.org'))
    def test_known_fixtures(self):
        self.assertFalse(self.check_text('7000000000000000001 https://v.example.test/a.mp4'))
    def test_metadata(self):
        import struct,zlib
        payload=b'tEXt'+b'Comment\x00private data'
        png=b'\x89PNG\r\n\x1a\n'+struct.pack('>I',len(payload)-4)+payload+struct.pack('>I',zlib.crc32(payload))
        self.assertIn('image metadata',inspect('sample.png',png))

if __name__=='__main__':unittest.main()
