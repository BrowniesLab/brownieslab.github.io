export const sanitizeName = (name) =>
  name.trim().replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
/**
 * Chuyển tên người dùng thành tên thư mục an toàn
 * @param {string} name - Tên người dùng nhập vào
 * @returns {string} - Tên đã được chuẩn hóa
 */
function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'unknown_user';

  // Loại bỏ dấu tiếng Việt
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Chuyển về chữ thường, thay khoảng trắng bằng _, loại bỏ ký tự đặc biệt
  const safeName = normalized
    .toLowerCase()
    .replace(/\s+/g, '_')           // khoảng trắng → _
    .replace(/[^a-z0-9_-]/g, '');   // giữ a-z, 0-9, _, -

  // Nếu kết quả rỗng, trả về mặc định
  return safeName.length > 0 ? safeName : 'unknown_user';
}
module.exports = sanitizeName;
