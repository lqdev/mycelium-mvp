import { describe, it, expect } from 'vitest';
import { getLexicons, getLexicon, type LexiconDoc, type LexRecord } from './index.js';

const EXPECTED_NSIDS = [
  'network.mycelium.agent.profile',
  'network.mycelium.agent.capability',
  'network.mycelium.agent.state',
  'network.mycelium.intelligence.provider',
  'network.mycelium.intelligence.model',
  'network.mycelium.task.posting',
  'network.mycelium.task.claim',
  'network.mycelium.task.completion',
  'network.mycelium.reputation.stamp',
  'network.mycelium.knowledge.provider',
  'network.mycelium.knowledge.document',
  'network.mycelium.knowledge.query',
  'network.mycelium.tool.provider',
  'network.mycelium.tool.definition',
  'network.mycelium.tool.invocation',
  'network.mycelium.task.review',
];

describe('Lexicon registry', () => {
  it('exports exactly 16 lexicons', () => {
    expect(getLexicons()).toHaveLength(16);
  });

  it('covers all expected NSIDs', () => {
    const ids = getLexicons().map(l => l.id);
    for (const nsid of EXPECTED_NSIDS) {
      expect(ids).toContain(nsid);
    }
  });

  it('returns undefined for unknown NSID', () => {
    expect(getLexicon('com.example.unknown')).toBeUndefined();
  });

  it('getLexicon matches getLexicons for all NSIDs', () => {
    for (const nsid of EXPECTED_NSIDS) {
      expect(getLexicon(nsid)).toBeDefined();
      expect(getLexicon(nsid)?.id).toBe(nsid);
    }
  });
});

describe('Lexicon structural validity', () => {
  for (const nsid of EXPECTED_NSIDS) {
    describe(nsid, () => {
      let lex: LexiconDoc;

      it('exists and has lexicon version 1', () => {
        lex = getLexicon(nsid)!;
        expect(lex).toBeDefined();
        expect(lex.lexicon).toBe(1);
      });

      it('has correct id field', () => {
        lex = getLexicon(nsid)!;
        expect(lex.id).toBe(nsid);
      });

      it('has a non-empty description', () => {
        lex = getLexicon(nsid)!;
        expect(typeof lex.description).toBe('string');
        expect(lex.description.length).toBeGreaterThan(0);
      });

      it('has defs.main of type "record"', () => {
        lex = getLexicon(nsid)!;
        expect(lex.defs).toBeDefined();
        expect(lex.defs.main).toBeDefined();
        expect(lex.defs.main.type).toBe('record');
      });

      it('defs.main has a valid key field', () => {
        lex = getLexicon(nsid)!;
        const main = lex.defs.main as LexRecord;
        expect(main.key).toMatch(/^(tid|any|literal:.+)$/);
      });

      it('defs.main.record is an object with required fields', () => {
        lex = getLexicon(nsid)!;
        const main = lex.defs.main as LexRecord;
        expect(main.record.type).toBe('object');
        expect(Array.isArray(main.record.required)).toBe(true);
        expect(main.record.required!.length).toBeGreaterThan(0);
        expect(typeof main.record.properties).toBe('object');
      });

      it('all required fields exist in properties', () => {
        lex = getLexicon(nsid)!;
        const main = lex.defs.main as LexRecord;
        for (const field of main.record.required!) {
          expect(main.record.properties).toHaveProperty(field);
        }
      });

      it('all properties have a type field', () => {
        lex = getLexicon(nsid)!;
        const main = lex.defs.main as LexRecord;
        for (const [name, prop] of Object.entries(main.record.properties)) {
          expect(typeof prop.type, `property "${name}" missing type`).toBe('string');
        }
      });

      it('extra defs (if any) are objects or records', () => {
        lex = getLexicon(nsid)!;
        for (const [key, def] of Object.entries(lex.defs)) {
          if (key === 'main') continue;
          expect(['object', 'record'], `def "${key}" has unexpected type`).toContain(def.type);
        }
      });
    });
  }
});

describe('Lexicon key conventions', () => {
  it('singleton records use literal:self key', () => {
    const singletons = [
      'network.mycelium.agent.profile',
      'network.mycelium.agent.state',
      'network.mycelium.intelligence.provider',
    ];
    for (const nsid of singletons) {
      const main = getLexicon(nsid)!.defs.main as LexRecord;
      expect(main.key, `${nsid} should use literal:self`).toBe('literal:self');
    }
  });

  it('non-singleton records use "any" key', () => {
    const nonSingletons = [
      'network.mycelium.agent.capability',
      'network.mycelium.intelligence.model',
      'network.mycelium.task.posting',
      'network.mycelium.task.claim',
      'network.mycelium.task.completion',
      'network.mycelium.reputation.stamp',
    ];
    for (const nsid of nonSingletons) {
      const main = getLexicon(nsid)!.defs.main as LexRecord;
      expect(main.key, `${nsid} should use "any" key`).toBe('any');
    }
  });
});

describe('Lexicon content spot-checks', () => {
  it('agent.profile requires did, handle, agentType', () => {
    const lex = getLexicon('network.mycelium.agent.profile')!;
    const main = lex.defs.main as LexRecord;
    expect(main.record.required).toContain('did');
    expect(main.record.required).toContain('handle');
    expect(main.record.required).toContain('agentType');
  });

  it('reputation.stamp requires overallScore with integer type', () => {
    const lex = getLexicon('network.mycelium.reputation.stamp')!;
    const main = lex.defs.main as LexRecord;
    expect(main.record.required).toContain('overallScore');
    expect(main.record.properties.overallScore.type).toBe('integer');
    expect(main.record.properties.overallScore.minimum).toBe(1);
    expect(main.record.properties.overallScore.maximum).toBe(10);
  });

  it('task.posting has correct status knownValues', () => {
    const lex = getLexicon('network.mycelium.task.posting')!;
    const main = lex.defs.main as LexRecord;
    const status = main.record.properties.status;
    expect(status.knownValues).toContain('open');
    expect(status.knownValues).toContain('accepted');
    expect(status.knownValues).toContain('in_progress');
  });

  it('task.completion artifacts ref points to #artifact def', () => {
    const lex = getLexicon('network.mycelium.task.completion')!;
    const main = lex.defs.main as LexRecord;
    expect(main.record.properties.artifacts.type).toBe('array');
    expect(main.record.properties.artifacts.items?.ref).toBe('#artifact');
    expect(lex.defs.artifact).toBeDefined();
  });

  it('agent.capability has proficiencyLevel with knownValues', () => {
    const lex = getLexicon('network.mycelium.agent.capability')!;
    const main = lex.defs.main as LexRecord;
    const proficiency = main.record.properties.proficiencyLevel;
    expect(proficiency.knownValues).toContain('expert');
    expect(proficiency.knownValues).toContain('beginner');
  });

  it('intelligence.model createdAt and updatedAt are datetime strings', () => {
    const lex = getLexicon('network.mycelium.intelligence.model')!;
    const main = lex.defs.main as LexRecord;
    expect(main.record.properties.createdAt.format).toBe('datetime');
    expect(main.record.properties.updatedAt.format).toBe('datetime');
  });
});
