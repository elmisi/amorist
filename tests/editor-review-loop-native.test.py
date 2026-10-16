import json,os,signal,subprocess,tempfile,time,sys
from pathlib import Path
assert sys.platform == 'linux', 'Native loop automation requires Linux/X11'
repo=Path(__file__).resolve().parent.parent;root=repo/'tests/qa/lib';scratch=Path(tempfile.mkdtemp(prefix='amorist-review-loop-'))
sys.path.insert(0,str(repo/'scripts'))
from review_identity import probe
application=Path(os.environ.get('AMORIST_QA_APPLICATION',str(repo/'src-tauri/target/debug/amorist'))).resolve()
assert application.is_file(), 'Build the native application or set AMORIST_QA_APPLICATION'
info=probe([str(application)])
files=[scratch/'first λ.md',scratch/'-- second 🧪.md'];sources=[b'# First\r\nText one\r\n',b'# Second\nText two\n']
for p,source in zip(files,sources):p.write_bytes(source)
listing=scratch/'files.txt';listing.write_text('\n'.join(map(str,files))+'\n')
reference=scratch/'reference.json';reference.write_text(json.dumps({**info,'executable':str(application)}))
state=scratch/'state.json';env={**os.environ,'AMORIST_LOOP_APPLICATION':str(application),'AMORIST_LOOP_REPO':str(repo),'AMORIST_LOOP_SCRATCH':str(scratch),'AMORIST_LOOP_CLOSE_HELPER':str(root/'focus-x11.py'),'XDG_DATA_HOME':str(scratch/'data'),'XDG_CONFIG_HOME':str(scratch/'config'),'XDG_CACHE_HOME':str(scratch/'cache')}
args=['python3',str(repo/'scripts/review-markdown-files.py'),'--debug','--amorist',str(root/'native-review-app-adapter.js'),'--release-reference',str(reference),'--list',str(listing),'--state',str(state)]
def wait_stage(phase,file):
 p=scratch/(phase+'-'+file.name+'.ready.json');end=time.monotonic()+90
 while not p.exists():
  if process.poll() is not None:raise RuntimeError('Runner stopped before native stage: '+(scratch/(phase+'.log')).read_text())
  assert time.monotonic()<end,'Native stage timeout: '+phase+' / '+file.name+'\n'+(scratch/(phase+'.log')).read_text();time.sleep(.04)
 return json.loads(p.read_text())
def launch(phase,bug):
 e={**env,'AMORIST_LOOP_PHASE':phase,'AMORIST_LOOP_BUG':bug}
 with (scratch/(phase+'.log')).open('w') as log:return subprocess.Popen(args,env=e,stdout=log,stderr=subprocess.STDOUT)
def close(stage):Path(stage['control']).touch()
process=launch('interrupt','1')
try:
 stage=wait_stage('interrupt',files[0]);assert stage['wrongPidRefused'];process.send_signal(signal.SIGINT);time.sleep(.3)
 assert process.poll() is None and Path('/proc',str(stage['pid'])).exists(),'Ctrl+C killed or prematurely abandoned the native app'
 close(stage);assert process.wait(timeout=10)==130
 initial=json.loads(state.read_text());assert initial['runs'][info['buildId']]['completed']==[]
 assert [e['event'] for e in initial['events']]==['opened','interrupted']
 reports=[json.loads(line) for line in (scratch/'data/dev.elmisi.amorist/problem-reports.jsonl').read_text().splitlines()]
 assert len(reports)==1 and reports[0]['schemaVersion']==2 and reports[0]['markdown']==sources[0].decode()
 assert reports[0]['note']=='QA native review loop interruption'
 def build_ids(value):
  if isinstance(value,dict):return ([value['buildId']] if 'buildId' in value else [])+sum((build_ids(v) for v in value.values()),[])
  if isinstance(value,list):return sum((build_ids(v) for v in value),[])
  return []
 assert info['buildId'] in build_ids(reports[0]),'Native Bug build identity mismatch'
 process=launch('resume','0');first=wait_stage('resume',files[0]);close(first);second=wait_stage('resume',files[1]);close(second);assert process.wait(timeout=10)==0
 final=json.loads(state.read_text());assert final['runs'][info['buildId']]['completed']==list(map(str,files))
 assert [e['event'] for e in final['events']]==['opened','interrupted','opened','closed','opened','closed']
 process=launch('completed','0');assert process.wait(timeout=10)==0
 assert not list(scratch.glob('completed-*.ready.json')),'Completed round opened extra windows'
 for p,source in zip(files,sources):assert p.read_bytes()==source
 output=Path(os.environ.get('AMORIST_QA_OUTPUT_DIR',str(scratch)));output.mkdir(parents=True,exist_ok=True)
 (output/'native-review-loop-result.json').write_text(json.dumps({'result':'pass','scratch':str(scratch),'identity':info,'events':[e['event'] for e in final['events']],'nativeBug':True,'ctrlCKeptWindowAlive':True,'mismatchedWindowPidRefused':True,'completedResumeOpenedNoWindow':True,'originalCopiesUnchanged':True},indent=2)+'\n')
 print('Native review loop PASS: two files, actual Bug, Ctrl+C keeps app alive, restart reopens interrupted file, completed round opens nothing; copies unchanged')
finally:
 if process.poll() is None:
  for phase in ['interrupt','resume','completed']:
   for p in files:(scratch/(phase+'-'+p.name+'.ready.json.close')).touch()
  process.send_signal(signal.SIGINT)
  try:process.wait(timeout=10)
  except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=5)
