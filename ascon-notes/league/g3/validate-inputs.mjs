/** Offline validation: use the exact repository run-league --dry-run validator,
 * then check the G3 pairing contract. Does not start matrix/Anvil. */
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import YAML from 'yaml';
const dir='ascon-notes/league/g3/';
export function validate() {
  const results=[];
  for(const field of ['ref','mix']) {
    const rosters={};
    for(const mode of ['off','on']) {
      const name=field+'-'+mode+'.yaml';
      const r=YAML.parse(readFileSync(dir+name,'utf8'));rosters[mode]=r;
      const missing=r.agents.filter(a=>!existsSync(resolve('example/agents',a.dir??a.id,'agent.ts'))).map(a=>a.id);
      const checked=spawnSync('bash',['ascon-notes/league/run-league.sh','--dry-run','--roster',dir+name],{encoding:'utf8'});
      results.push({file:name,validator:'run-league.sh --dry-run',exitCode:checked.status,missing,
        stdout:checked.stdout.trim(),stderr:checked.stderr.trim(),status:checked.status===0?'PASS':'BLOCKED'});
      assert.deepEqual(missing,[]);
      assert.equal(checked.status,0);
      assert.equal(r.agents.find(a=>a.id==='cand').dir,'ascon-zeta-r3');
      assert.equal(r.agents.filter(a=>a.baseline).length,1);
      assert.equal(r.agents.find(a=>a.baseline).id,'noop');
      for(const a of r.agents) {
        assert.equal(a.wallet,'AUTO');
        if(a.id!=='cand')assert.equal(a.env.ERIS_AGENT_FROZEN,'1');
      }
    }
    const off=structuredClone(rosters.off),on=rosters.on;
    assert.equal(off.agents.at(-1).env.ERIS_AGENT_FROZEN,'1');
    delete off.agents.at(-1).env.ERIS_AGENT_FROZEN;
    assert.deepEqual(off,on);
    assert.deepEqual(on.agents.map(a=>a.id),field==='ref'?['noop','multi-arb','clean-arb','cand']:
      ['noop','venue-arb','multi-arb','clean-arb','astra-1','astra-2','sonnet-1','sonnet-2','opus-1','inc-zeta','fixed-bid-5gwei','cand']);
  }
  return results;
}
console.log(JSON.stringify(validate(),null,2));
