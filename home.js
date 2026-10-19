/* Xem từng vị bánh: đổi ảnh và mô tả, không thêm bánh vào giỏ. */
(() => {
  const flavors = {
    classic: {
      title: 'Classic', code: 'CL / 01', image: 'assets/brownie-classic.png',
      alt: 'Hộp brownie Classic đậm chocolate', caption: 'CHOCOLATE',
      description: 'Brownie chocolate đậm vị, ruột bánh mềm ẩm và đặc mịn.',
      tags: ['Đậm vị cacao', 'Mềm ẩm', 'Đặc mịn']
    },
    matcha: {
      title: 'Matcha', code: 'MA / 02', image: 'assets/brownie-matcha.png',
      alt: 'Hộp brownie Matcha mềm ẩm', caption: 'MATCHA',
      description: 'Brownie matcha mềm ẩm, vị trà thanh dịu, ngọt vừa đủ.',
      tags: ['Thơm matcha', 'Thanh dịu', 'Mềm ẩm']
    },
    mix: {
      title: 'Mix', code: 'MX / 03', image: 'assets/brownie-mix.png',
      alt: 'Hộp brownie Mix gồm chocolate và matcha', caption: 'CHOCOLATE & MATCHA',
      description: 'Kết hợp brownie chocolate và matcha trong cùng một hộp.',
      tags: ['Chocolate + matcha', 'Hai vị một hộp', 'Mềm ẩm']
    }
  };

  const picker = document.querySelector('.lab-flavor-picker');
  picker.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-flavor]');
    if (!button || button.getAttribute('aria-pressed') === 'true') return;
    const flavor = flavors[button.dataset.flavor];
    if (!flavor) return;

    picker.querySelectorAll('button').forEach((option) => {
      option.setAttribute('aria-pressed', String(option === button));
    });
    const image = document.getElementById('flavor-image');
    image.src = flavor.image;
    image.alt = flavor.alt;
    document.getElementById('flavor-code').textContent = flavor.code;
    document.getElementById('flavor-title').textContent = flavor.title;
    document.getElementById('flavor-caption').textContent = flavor.caption;
    document.getElementById('flavor-description').textContent = flavor.description;
    document.getElementById('flavor-tags').replaceChildren(...flavor.tags.map((label) => {
      const tag = document.createElement('span');
      tag.textContent = label;
      return tag;
    }));
  });

  const mobileMenu = document.querySelector('.lab-mobile-menu');
  mobileMenu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => { mobileMenu.open = false; });
  });
  mobileMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      mobileMenu.open = false;
      mobileMenu.querySelector('summary').focus();
    }
  });

  if (Session.get()) {
    document.querySelectorAll('[data-account-link]').forEach((link) => {
      link.textContent = 'Đơn của tôi';
      link.href = 'order.html?tab=history';
    });
  }
})();
