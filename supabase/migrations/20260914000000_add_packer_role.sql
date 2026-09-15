-- เพิ่ม role "PACKER" (พนักงานแพ็กของ) — ทำงานเฉพาะสายส่งของออก: หยิบ → แพ็ก → ขึ้นรถ
alter type stockify_user_role add value if not exists 'PACKER' after 'WAREHOUSE_STAFF';
