import hashlib, io, json, os, re, subprocess, sys, tarfile
from pathlib import Path
# Source path, source commit and eval base are REQUIRED explicit inputs (same names as
# chain.py). No default; no fallback to any earlier round's worktree, commit or /tmp base.
TEMP_ROOTS=('/tmp','/var/tmp')
def stop(message):
    print('BLOCKED: '+message,file=sys.stderr); sys.exit(2)
def explicit_dir(name):
    value=os.environ.get(name)
    if not value: stop(name+' missing or empty; explicit value required (no default)')
    path=Path(value)
    if not path.is_absolute(): stop(name+' must be an absolute path')
    if any(path.is_relative_to(root) or path.resolve().is_relative_to(Path(root).resolve()) for root in TEMP_ROOTS):
        stop(name+' must not be under /tmp or /var/tmp')
    if not path.is_dir(): stop(name+' does not exist or is not a directory')
    return path
src=explicit_dir('G3_CHAIN_SOURCE')
commit=os.environ.get('G3_CHAIN_SOURCE_COMMIT')
if not commit: stop('G3_CHAIN_SOURCE_COMMIT missing or empty; explicit value required (no default)')
if not re.fullmatch(r'[0-9a-f]{40}',commit): stop('G3_CHAIN_SOURCE_COMMIT must be exactly 40 lowercase hex characters (full commit, no prefix)')
eval_base=explicit_dir('G3_CHAIN_BASE')
out=eval_base/'source-view'
manifest_path=eval_base/'source-manifest.json'
if out.exists() or manifest_path.exists(): stop('refuse overwriting source view or source manifest')
def git(*args): return subprocess.check_output(['git','-C',str(src),*args])
head=git('rev-parse','HEAD').decode().strip()
# Full 40-character equality, never a prefix match.
if head!=commit: stop('source HEAD differs from G3_CHAIN_SOURCE_COMMIT')
rows=git('ls-tree','-rz',commit).split(b'\0')
selected=[]; skipped=[]
for raw in rows:
    if not raw: continue
    meta,name=raw.split(b'\t',1); name=name.decode(); parts=Path(name).parts
    sensitive=any(p.startswith('.env') or p in {'.git','.ssh','.aws','.codex','.agents'} or re.search(r'credential|secret|private.?key',p,re.I) or Path(p).suffix in {'.pem','.key','.p12'} for p in parts)
    if sensitive or meta.split()[0] not in {b'100644',b'100755'}: skipped.append(name)
    else: selected.append(name)
# Explicit path list excludes sensitive blobs BEFORE git reads archive contents.
archive=git('archive','--format=tar',commit,'--',*selected)
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
manifest={'source':str(src),'head':head,'absoluteGitDir':git('rev-parse','--absolute-git-dir').decode().strip(),'branch':git('branch','--show-current').decode().strip(),'mainRef':git('rev-parse','main').decode().strip(),'files':hashes,'skippedPaths':skipped}
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'head':head,'branch':manifest['branch'],'mainRef':manifest['mainRef'],'exportedFiles':len(hashes),'skippedPaths':len(skipped)}))
