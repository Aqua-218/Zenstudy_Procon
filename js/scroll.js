// 巻物 UI。右端から左へ、紙が広がる。

export class Scroll {
  constructor(root) {
    this.root = root;
    this.frame = root.querySelector('.scroll-frame');
    this.mount = root.querySelector('.mount');
    this.paper = root.querySelector('.paper');
    this.inner = root.querySelector('.paper .inner');
    this.title = root.querySelector('.paper h2');
    this.body = root.querySelector('.paper .body');
    this.roller = root.querySelector('.roll');
    this.tassel = root.querySelector('.tassel');
    this.isOpen = false;
    this.onClose = null;
    this.anim = null;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.querySelector('.close').addEventListener('click', () => this.close());
    root.addEventListener('click', e => { if (e.target === root) this.close(); });
  }

  show(title, paragraphs, onClose = null) {
    this.title.textContent = title;
    this.body.replaceChildren(...paragraphs.map(t => { const p = document.createElement('p'); p.textContent = t; return p; }));
    this.onClose = onClose;
    this.isOpen = true;
    this.root.classList.add('open');
    this.fit();
    this.unroll();
    // 縦書きは右端が先頭
    requestAnimationFrame(() => { this.paper.scrollLeft = this.paper.scrollWidth; });
  }

  unroll() {
    if (this.anim) cancelAnimationFrame(this.anim);
    if (this.reduce) { this.set(0); return; }
    const t0 = performance.now(), dur = 900;
    const step = now => {
      const x = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - x, 3);
      this.set(100 - e * 100);
      if (x < 1) this.anim = requestAnimationFrame(step);
    };
    this.set(100);
    this.anim = requestAnimationFrame(step);
  }

  // 本紙の幅を決める。縦書きは横方向に伸びるので自動では決まらない。
  // 画面に入りきらないときは入る分だけにして、足りない分は紙を軸の間で送る
  fit() {
    this.paper.style.width = '';
    const cs = getComputedStyle(this.paper), fs = getComputedStyle(this.frame), rs = getComputedStyle(this.root);
    const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const want = Math.ceil(this.inner.scrollWidth + pad);
    // 軸の張り出しと房と、外側の余白のぶんを引く
    const rollW = parseFloat(fs.getPropertyValue('--rollW')) || 92;
    const room = innerWidth
      - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight)
      - rollW * 0.55 - (this.tassel ? this.tassel.offsetWidth : 0)
      - parseFloat(fs.getPropertyValue('--edge')) * 2;
    this.paper.style.width = `${Math.max(160, Math.min(want, Math.floor(room)))}px`;
  }

  // 表装ごと左側 pct% を隠す。動く軸は隠れている境目に置く (右端 → 左端)
  set(pct) {
    this.mount.style.clipPath = `inset(0 0 0 ${pct}%)`;
    this.roller.style.left = `${pct}%`;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    const cb = this.onClose; this.onClose = null;
    if (cb) cb();
  }
}
