import { describe, expect, it } from 'vitest';
import { createEngine } from '../src';
import type { Character } from '../src';
import { porter, vector } from './fixtures';

const engine = createEngine();
const build = (overrides: Parameters<typeof engine.buildContext>[1] = {}) => engine.buildContext(porter, overrides);

describe('buildContext', () => {
  it('opens with the core block and closes with the re-anchor', () => {
    const prompt = build();
    expect(prompt.startsWith('You are Halden')).toBe(true);
    expect(prompt.endsWith(engine.prose.coreReanchor)).toBe(true);
  });

  it('always carries the abstract of every secret', () => {
    expect(build()).toContain('something about that night you have decided not to volunteer');
  });

  describe('the secret gate', () => {
    it('withholds the payload below the threshold', () => {
      const prompt = build({ state: vector({ guilt: 3 }) });
      expect(prompt).toContain('CURRENT EMOTIONAL STATE');
      expect(prompt).not.toContain('stepped out to the yard');
      expect(prompt).not.toContain('[SECRET id:"left-the-desk"]');
    });

    it('injects payload and marker phrase once it opens', () => {
      const prompt = build({ state: vector({ guilt: 4 }) });
      expect(prompt).toContain('left the desk unattended');
      expect(prompt).toContain('[SECRET id:"left-the-desk"]');
      expect(prompt).toContain('All right — I was not at the desk');
    });

    it('falls back to baseline when no state is supplied, leaving the gate shut', () => {
      // baseline guilt is 1, well under the threshold of 4
      expect(build()).not.toContain('stepped out to the yard');
    });
  });

  describe('with the emotional layer off', () => {
    const prompt = build({ emotional: false });

    it('drops the state block and the report instruction', () => {
      expect(prompt).not.toContain('CURRENT EMOTIONAL STATE');
      expect(prompt).not.toContain('<<<EMO>>>');
    });

    it('gates the secret on its narrative condition instead', () => {
      expect(prompt).toContain('left the desk unattended');
      expect(prompt).toContain('Admit it only if the inspector proves the desk was empty');
    });
  });

  describe('stages', () => {
    it('includes only the requested stage', () => {
      const prompt = build({ stage: 2 });
      expect(prompt).toContain('the guest in room 12 is dead');
      expect(prompt).not.toContain('have not yet been told anyone died');
    });

    it('includes none when no stage is requested', () => {
      expect(build()).not.toContain('room 12');
    });
  });

  describe('scene context', () => {
    it('renders each supplied block and omits the rest', () => {
      const prompt = build({
        scene: {
          scenario: 'It is four in the morning.',
          cast: 'the manager, the kitchen girl',
          focus: 'The inspector sets a wet ledger on the desk.',
          coPresence: 'The manager is standing behind you.',
          facts: 'The front door was locked from ten onward.',
          extra: ['The lamp above the desk is broken.'],
        },
      });
      expect(prompt).toContain('It is four in the morning.');
      expect(prompt).toContain('The people around you: the manager, the kitchen girl');
      expect(prompt).toContain('wet ledger');
      expect(prompt).toContain('The lamp above the desk is broken.');
      expect(prompt).toContain('The manager is standing behind you.');
      expect(prompt).toContain('locked from ten onward');
    });

    it('puts shared facts after co-presence', () => {
      const prompt = build({
        scene: { coPresence: 'CO_PRESENCE_MARK', facts: 'FACTS_MARK' },
      });
      expect(prompt.indexOf('CO_PRESENCE_MARK')).toBeLessThan(prompt.indexOf('FACTS_MARK'));
    });
  });

  it('omits optional character fields cleanly', () => {
    const bare: Character = {
      identity: 'You are a stranger.',
      epistemicBound: 'You know nothing of value.',
      traits: porter.traits,
      emotion: { active: [], baseline: {}, sensitivities: '' },
    };
    const prompt = engine.buildContext(bare);
    expect(prompt).not.toContain('YOUR ACTIVE EMOTIONS');
    expect(prompt).toContain('YOUR PERSONALITY:');
    expect(prompt).toContain('CURRENT EMOTIONAL STATE');
  });

  it('orders background after voice and before the secret abstracts', () => {
    const prompt = engine.buildContext({ ...porter, background: 'BACKGROUND_MARK' });
    expect(prompt.indexOf(porter.voice!)).toBeLessThan(prompt.indexOf('BACKGROUND_MARK'));
    expect(prompt.indexOf('BACKGROUND_MARK')).toBeLessThan(prompt.indexOf('decided not to volunteer'));
  });

  it('declares events before the report instruction that references them', () => {
    const out = engine.buildContext({ ...porter, events: [{ id: 'paid', when: 'you confirmed the payment' }] }, {});
    // Without this, a missing block makes `indexOf` return -1 and the ordering
    // assertion below passes on nothing at all.
    expect(out).toContain('[EVENT id:"paid"]');
    expect(out.indexOf('[EVENT id:"paid"]')).toBeLessThan(out.indexOf('"events":[]'));
  });

  it('declares no events when the emotional layer is off, since there is no report block', () => {
    const withEvents = { ...porter, events: [{ id: 'paid', when: 'you confirmed the payment' }] };
    const off = engine.buildContext(withEvents, { emotional: false });
    expect(off).not.toContain('[EVENT id:"paid"]');
    expect(off).not.toContain('"events":[]');
    // The same character with emotions on does declare them — otherwise the two
    // assertions above would hold for a build that dropped events entirely.
    expect(engine.buildContext(withEvents, {})).toContain('[EVENT id:"paid"]');
  });
});
