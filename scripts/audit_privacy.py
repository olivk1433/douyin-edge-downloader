"""Fail closed on common accidental personal-data and credential patterns."""
from pathlib import Path
import re,struct,sys

ROOT=Path(__file__).resolve().parents[1]
IGNORED={'.git','dist','node_modules','__pycache__'}
FIXTURE_IDS={'7000000000000000001','7000000000000000002'}
RULES={
    'absolute home path':r'(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|/(?:home|Users)/)[^\s\]"<>]+',
    'GitHub token':r'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})',
    'AWS access key':r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
    'private key':r'-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----',
    'signed media URL':r'https?://[^\s"<>]*(?:douyinvod|bytecdn)[^\s"<>]*[?&](?:sign|signature|X-Bogus|ft|token)=',
    'clipboard attachment':r'codex-clipboard-[0-9a-f-]{20,}',
}
TEXT_SUFFIXES={'.js','.mjs','.json','.md','.yml','.yaml','.py','.html','.css','.txt','.toml'}

def inspect(name,data):
    findings=[]
    if name.endswith('.png'):
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):return ['invalid PNG']
        offset=8
        while offset<len(data):
            if offset+12>len(data):return ['truncated PNG']
            size=struct.unpack('>I',data[offset:offset+4])[0]
            if data[offset+4:offset+8] in {b'tEXt',b'iTXt',b'zTXt',b'eXIf',b'tIME'}:findings.append('image metadata')
            offset+=size+12
        return findings
    if Path(name).suffix not in TEXT_SUFFIXES and Path(name).name not in {'LICENSE','.gitignore','.gitattributes'}:return findings
    text=data.decode('utf8')
    for label,pattern in RULES.items():
        if re.search(pattern,text,re.I if label=='absolute home path' else 0):findings.append(label)
    if any(v not in FIXTURE_IDS for v in re.findall(r'(?<!\d)\d{17,20}(?!\d)',text)):findings.append('non-fixture long numeric identifier')
    for address in re.findall(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}',text):
        domain=address.rsplit('@',1)[-1]
        if not (domain.endswith(('.invalid','.example.test')) or domain in {'example.com','example.test'}):findings.append('email address')
    return findings

def audit():
    failed=[];count=0
    for file in ROOT.rglob('*'):
        relative=file.relative_to(ROOT)
        if any(part in IGNORED for part in relative.parts) or not file.is_file():continue
        count+=1
        if file.suffix.lower() in {'.mp4','.webm','.har','.pem','.pfx','.key','.log'} or file.name.startswith(('.env','cookies','credentials')):
            failed.append((relative.as_posix(),['private/runtime file type']));continue
        findings=inspect(relative.as_posix(),file.read_bytes())
        if findings:failed.append((relative.as_posix(),findings))
    if failed:
        for name,findings in failed:print(name+': '+', '.join(sorted(set(findings))))
        raise SystemExit(1)
    print(f'Privacy audit passed: {count} allowlisted project files; no matching personal data or secrets.')

if __name__=='__main__':audit()
