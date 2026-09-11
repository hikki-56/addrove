-- เพิ่มประเภทเอกสาร RECEIVE_PLAN (แผนรับสินค้า)
-- ใช้ในฟีเจอร์ "รับสินค้าเข้าโกดังตามแผน": แอดมินสร้างแผน → พนักงานรับตามแผน
-- (production ใช้ Google Sheets เป็น source of truth — document_type เป็นข้อความอิสระ
--  ไม่ต้องแก้โครงสร้างชีต; migration นี้สำหรับ staging Postgres เท่านั้น)
do $$
begin
  alter type stockify_document_type add value if not exists 'RECEIVE_PLAN';
exception
  when duplicate_object then null;
end $$;
