// 立て札 UI。白木の板に墨書き、上に小屋根。境内に立っているものと同じ形にする。

export class Board {
  constructor(root) {
    this.root = root;
    this.title = root.querySelector('.fuda-title');
    this.body = root.querySelector('.fuda-body');
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
    requestAnimationFrame(() => { this.root.scrollLeft = this.root.scrollWidth; });
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
