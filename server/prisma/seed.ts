import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding baseline data for E-Commerce Ordering System...");

  const saltRounds = 10;
  const operatorPasswordHash = await bcrypt.hash(
    process.env.ADMIN_PASSWORD || process.env.OPERATOR_PASSWORD || "OperatorPass123!",
    saltRounds
  );
  const customerPasswordHash = await bcrypt.hash(
    process.env.DEMO_USER_PASSWORD || "CustomerPass123!",
    saltRounds
  );

  // 1. Seed Operator
  const operator = await prisma.user.upsert({
    where: { email: "operator@store.com" },
    update: { password_hash: operatorPasswordHash, role: Role.OPERATOR },
    create: {
      email: "operator@store.com",
      password_hash: operatorPasswordHash,
      role: Role.OPERATOR,
    },
  });
  console.log(`Seeded Operator: ${operator.email} (${operator.id})`);

  // 2. Seed Customers
  const customerAlice = await prisma.user.upsert({
    where: { email: "alice@customer.com" },
    update: { password_hash: customerPasswordHash, role: Role.CUSTOMER },
    create: {
      email: "alice@customer.com",
      password_hash: customerPasswordHash,
      role: Role.CUSTOMER,
    },
  });

  const customerBob = await prisma.user.upsert({
    where: { email: "bob@customer.com" },
    update: { password_hash: customerPasswordHash, role: Role.CUSTOMER },
    create: {
      email: "bob@customer.com",
      password_hash: customerPasswordHash,
      role: Role.CUSTOMER,
    },
  });
  console.log(`Seeded Customers: ${customerAlice.email}, ${customerBob.email}`);

  // 3. Seed Products
  const products = [
    {
      id: "prod-keyboard-01",
      name: "Mechanical Keyboard RGB",
      description: "Custom mechanical keyboard with tactile brown switches",
      price: 129.99,
      stock: 10,
    },
    {
      id: "prod-mouse-02",
      name: "Ergonomic Gaming Mouse",
      description: "Wireless high-precision 16000 DPI gaming mouse",
      price: 59.99,
      stock: 25,
    },
    {
      id: "prod-cable-03",
      name: "Braided USB-C Cable 2M",
      description: "Durable fast charging 100W PD nylon braided cable",
      price: 14.99,
      stock: 50,
    },
  ];

  for (const item of products) {
    await prisma.product.upsert({
      where: { id: item.id },
      update: {
        name: item.name,
        description: item.description,
        price: item.price,
        stock: item.stock,
      },
      create: item,
    });
  }
  console.log(`Seeded ${products.length} catalog products.`);
  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error("Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
