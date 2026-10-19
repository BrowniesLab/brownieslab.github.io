/* Sổ thử vị: đổi ảnh và ghi chú, không thêm bánh vào giỏ. */
(() => {
  const flavors = {
    classic: {
      title: 'Classic', code: 'CL / 01', image: 'assets/brownie-classic.png',
      alt: 'Hộp brownie Classic đậm chocolate', caption: 'CHO HỘI MÊ CHOCOLATE',
      description: 'Đậm chocolate, ruột bánh mềm ẩm. Vị quen, nhưng chẳng bao giờ chán.',
      tags: ['Đậm vị cacao', 'Mềm ẩm', 'Đặc mịn']
    },
    matcha: {
      title: 'Matcha', code: 'MA / 02', image: 'assets/brownie-matcha.png',
      alt: 'Hộp brownie Matcha mềm ẩm', caption: 'CHO MỘT CHÚT ĐỔI GIÓ',
      description: 'Matcha thanh dịu, ngọt vừa đủ. Một khoảng nghỉ có hương trà.',
      tags: ['Thơm matcha', 'Thanh dịu', 'Mềm ẩm']
    },
    mix: {
      title: 'Mix', code: 'MX / 03', image: 'assets/brownie-mix.png',
      alt: 'Hộp brownie Mix gồm chocolate và matcha', caption: 'CHO HỘI KHÓ CHỌN',
      description: 'Chocolate hay matcha? Có những câu hỏi chỉ cần trả lời: lấy cả hai.',
      tags: ['Chocolate + matcha', 'Hai vị một hộp', 'Dễ chia sẻ']
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
    document.getElementById('flavor-code').textContent = 'HỒ SƠ ' + flavor.code;
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
