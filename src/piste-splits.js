// Require a few ski lengths on the new surface. Adjacent centre lines can
// alternate at a junction even while the skier stays on the same piste.
const pisteEntry = 12;
const offPisteExit = 22;

export class PisteSplits {
  current = null;
  candidate = null;
  completed = [];
  passages = [];

  add(key, distance, seconds) {
    if (!this.current && !this.candidate && (!key || distance === 0)) return;
    if (key === this.current?.key) {
      this.foldCandidate();
      this.current.distance += distance;
      this.current.seconds += seconds;
      return;
    }
    if (!this.candidate || key !== this.candidate.key) {
      this.foldCandidate();
      if (!this.current && !key) return;
      this.candidate = {key, distance:0, seconds:0};
    }
    const next = this.candidate;
    next.distance += distance;
    next.seconds += seconds;
    if (next.distance < (key ? pisteEntry : offPisteExit)) return;
    this.closeCurrent();
    this.current = key ? next : null;
    if(key)this.passages.push(key);
    this.candidate = null;
  }

  foldCandidate() {
    if (this.current && this.candidate) {
      this.current.distance += this.candidate.distance;
      this.current.seconds += this.candidate.seconds;
    }
    this.candidate = null;
  }

  closeCurrent() {
    if (this.current) {
      const {key, distance, seconds} = this.current;
      this.completed.push({
        key, name:key.slice(key.indexOf('/') + 1), distance, seconds,
        average:seconds > 0 ? 3.6 * distance / seconds : 0
      });
      this.current = null;
    }
  }

  finish() {
    this.foldCandidate();
    this.closeCurrent();
  }
}

// The descent counters also include unnamed connectors, time at rest on a run
// and a continued valley descent. Lift motion never advances these counters.
export function descentTotals(sim) {
  return {
    distance:sim.travel, seconds:sim.elapsed,
    average:sim.elapsed > 0 ? 3.6 * sim.travel / sim.elapsed : 0,
    peak:3.6 * sim.maxSpeed
  };
}
