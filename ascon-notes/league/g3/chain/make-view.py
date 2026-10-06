import hashlib, io, json, os, re, subprocess, tarfile
from pathlib import Path
src=Path('/Users/masashi_mac_ssd/Developer/ascon/.claude/worktrees/release-r2')
out=Path('/tmp/g3-chain/source-view')
assert not out.exists(), 'refuse overwriting source view'
def git(*args): return subprocess.check_output(['git','-C',str(src),*args])
head=git('rev-parse','HEAD').decode().strip()
assert head.startswith('ec80bb8')
rows=git('ls-tree','-rz','HEAD').split(b'\0')
selected=[]; skipped=[]
for raw in rows:
    if not raw: continue
    meta,name=raw.split(b'\t',1); name=name.decode(); parts=Path(name).parts
    sensitive=any(p.startswith('.env') or p in {'.git','.ssh','.aws','.codex','.agents'} or re.search(r'credential|secret|private.?key',p,re.I) or Path(p).suffix in {'.pem','.key','.p12'} for p in parts)
    if sensitive or meta.split()[0] not in {b'100644',b'100755'}: skipped.append(name)
    else: selected.append(name)
# Explicit path list excludes sensitive blobs BEFORE git reads archive contents.
archive=git('archive','--format=tar','HEAD','--',*selected)
out.mkdir()
hashes={}
with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
    for entry in tf:
        if not entry.isfile(): continue
        assert entry.name in selected
        dest=out/entry.name; dest.parent.mkdir(parents=True,exist_ok=True)
        data=tf.extractfile(entry).read(); dest.write_bytes(data)
        dest.chmod(0o555 if entry.mode & 0o111 else 0o444)
        hashes[entry.name]=hashlib.sha256(data).hexdigest()
for base,dirs,files in os.walk(out,topdown=False): Path(base).chmod(0o555)
manifest={'source':str(src),'head':head,'branch':git('branch','--show-current').decode().strip(),'mainRef':git('rev-parse','main').decode().strip(),'files':hashes,'skippedPaths':skipped}
Path('/tmp/g3-chain/source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'head':head,'branch':manifest['branch'],'mainRef':manifest['mainRef'],'exportedFiles':len(hashes),'skippedPaths':len(skipped)}))
