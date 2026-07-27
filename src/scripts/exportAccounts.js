require('dotenv').config();
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { sequelize, User, DeliveryPerson } = require('../models');

async function main() {
  await sequelize.authenticate();

  const users = await User.findAll({
    attributes: ['firstName', 'lastName', 'email', 'phoneNumber', 'isAdmin', 'accountStatus', 'createdAt'],
    order: [['isAdmin', 'DESC'], ['createdAt', 'ASC']],
  });

  const riders = await DeliveryPerson.findAll({
    attributes: ['name', 'phoneNumber', 'isActive', 'createdAt'],
    order: [['createdAt', 'ASC']],
  });

  const outPath = path.join(__dirname, '..', '..', 'uploads', 'accounts-report.pdf');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  doc.pipe(fs.createWriteStream(outPath));

  doc.fontSize(18).text('Eggys — Account Roster', { align: 'left' });
  doc.fontSize(10).fillColor('gray').text(`Generated ${new Date().toISOString()}`);
  doc.moveDown(1.5);

  doc.fillColor('black').fontSize(14).text('Users');
  doc.moveDown(0.5);
  users.forEach((u) => {
    const role = u.isAdmin ? 'Admin' : 'Customer';
    doc.fontSize(10).text(
      `${u.firstName} ${u.lastName}  |  ${u.email}  |  ${u.phoneNumber || '-'}  |  Role: ${role}  |  Status: ${u.accountStatus}`
    );
  });

  doc.moveDown(1.5);
  doc.fontSize(14).text('Delivery Personnel');
  doc.moveDown(0.5);
  riders.forEach((r) => {
    doc.fontSize(10).text(
      `${r.name}  |  ${r.phoneNumber}  |  Role: Delivery  |  Status: ${r.isActive ? 'active' : 'inactive'}`
    );
  });

  doc.end();
  doc.on('finish', () => {
    console.log(`Report written to ${outPath}`);
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
