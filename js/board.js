// 立て札 UI。白木の板に墨書き、上に小屋根。境内に立っているものと同じ形にする。

export class Board {
  constructor(root) {
    this.root = root;
    this.title = root.querySelector('.fuda-title');
    this.body = root.querySelector('.fuda-body');
    this.board = root.querySelector('.fuda-board');
    this.inner = root.querySelector('.fuda-inner');
    this.isOpen = false;
    this.onClose = null;
    root.querySelector('.close').addEventListener('click', () => this.close());
    root.addEventListener('click', e => { if (e.target === root) this.close(); });
  }

  show(title, paragraphs, onClose = null) {
    this.title.textContent = title;
    this.body.replaceChildren(...paragraphs.map(t => {
      const p = document.createElement('p');
      p.textContent = t;
      return p;
    }));
    this.onClose = onClose;
    this.isOpen = true;
    this.root.classList.add('open');
    this.fit();
  }

  // 縦書きは幅が自動で決まらないので、本文の実寸から板の幅を出す。
  // これをしないと小屋根や脚の幅が本文と合わない
  fit() {
    this.board.style.width = '';
    this.inner.style.width = '';
    const bs = getComputedStyle(this.board), is = getComputedStyle(this.inner);
    const pad = parseFloat(bs.paddingLeft) + parseFloat(bs.paddingRight)
              + parseFloat(is.paddingLeft) + parseFloat(is.paddingRight);
    const w = Math.ceil(this.inner.scrollWidth + pad);
    this.board.style.width = `${Math.min(w, Math.floor(innerWidth * 0.92))}px`;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
  }
}
