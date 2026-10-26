"""Build a deterministic runtime-only extension ZIP and SHA-256 checksum."""
from pathlib import Path
import hashlib,json,zipfile
from audit_privacy import audit,inspect

ROOT=Path(__file__).resolve().parents[1]
FILES=['manifest.json','background.js','scanner.js','media-capture.js','refresh-media.js','page-fetch.js','content.js','popup.html','popup.css','popup.js','utils.js','icons/16.png','icons/32.png','icons/48.png','icons/128.png','icons/puppy-perch.png']

def build():
    audit()
    version=json.loads((ROOT/'extension/manifest.json').read_text(encoding='utf8'))['version']
    assert version==json.loads((ROOT/'package.json').read_text(encoding='utf8'))['version']
    destination=ROOT/'dist';destination.mkdir(exist_ok=True)
    archive=destination/f'douyin-edge-v{version}.zip'
    entries={f'extension/{name}':(ROOT/'extension'/name).read_bytes() for name in FILES}
    entries['LICENSE']=(ROOT/'LICENSE').read_bytes()
    entries['INSTALL.txt']=('Open edge://extensions/, enable Developer mode, choose Load unpacked, and select the extension folder. Allow Douyin website access, then refresh the Douyin page. Runtime permissions and privacy information are documented in the source repository.\n').encode('utf8')
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for name,data in sorted(entries.items()):
            assert not inspect(name,data),name
            info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
            z.writestr(info,data)
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None
        assert set(z.namelist())==set(entries)
        for name,data in entries.items():assert z.read(name)==data
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum=destination/f'{archive.name}.sha256';checksum.write_text(f'{digest}  {archive.name}\n',encoding='utf8',newline='\n')
    print(f'Built and verified {archive.name}: {archive.stat().st_size} bytes')
    return archive,checksum

if __name__=='__main__':build()
