'use strict';

// GERA OS ÍCONES DO AGENT a partir da logo da banda (a mesma do PWA do site).
//
//   node scripts/gerar-icones.js
//
// Origem: scripts/origem/logo-banda.png — cópia byte a byte de
// frontend/public/logo-banda.png do repositório principal (512×512, sem alpha,
// emblema circular que encosta nas bordas, cantos preenchidos com #111111).
// O Agent é um repositório separado, então a origem vem copiada para cá.
//
// Saídas (COMMITADAS; este script não roda no build — sharp é dependência de
// desenvolvimento e não vai para o instalador):
//   assets/icon.ico  16, 24, 32, 48, 64, 128, 256 — instalador, atalhos, Explorer
//   assets/icon.png  256 — bandeja e janela do Electron
//
// Diferente do PWA, aqui NÃO há fundo: no Windows o ícone aparece solto sobre a
// área de trabalho, a barra de tarefas e a bandeja (claras ou escuras), sem
// máscara de plataforma. Recorta-se o círculo inscrito (que é o próprio
// emblema) e os cantos ficam transparentes.
//
// Formato do .ico: 256 em PNG (padrão desde o Vista); os demais em BMP 32 bits
// com máscara AND, o formato clássico que o NSIS e o Explorer leem sem surpresa.

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const RAIZ    = path.join(__dirname, '..');
const ORIGEM  = path.join(__dirname, 'origem', 'logo-banda.png');
const ICO     = path.join(RAIZ, 'assets', 'icon.ico');
const PNG     = path.join(RAIZ, 'assets', 'icon.png');
const TAMANHOS = [16, 24, 32, 48, 64, 128, 256];

function mascaraCircular(lado) {
  return Buffer.from(
    `<svg width="${lado}" height="${lado}">` +
      `<circle cx="${lado / 2}" cy="${lado / 2}" r="${lado / 2}" fill="#fff"/>` +
      `</svg>`,
  );
}

// Emblema recortado em círculo, cantos transparentes, lado×lado RGBA.
async function emblema(lado) {
  return sharp(ORIGEM)
    .resize(lado, lado, { fit: 'cover', kernel: 'lanczos3' })
    .ensureAlpha()
    .composite([{ input: mascaraCircular(lado), blend: 'dest-in' }]);
}

async function pngDe(lado) {
  return (await emblema(lado)).png({ compressionLevel: 9 }).toBuffer();
}

// Entrada BMP de .ico: BITMAPINFOHEADER + pixels BGRA de baixo para cima + máscara AND.
async function bmpDe(lado) {
  const { data } = await (await emblema(lado)).raw().toBuffer({ resolveWithObject: true });
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);          // biSize
  header.writeInt32LE(lado, 4);         // biWidth
  header.writeInt32LE(lado * 2, 8);     // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12);          // biPlanes
  header.writeUInt16LE(32, 14);         // biBitCount
  // biCompression = 0 (BI_RGB); demais campos zerados

  const xor = Buffer.alloc(lado * lado * 4);
  const linhaMascara = Math.ceil(lado / 32) * 4;
  const and = Buffer.alloc(linhaMascara * lado); // 0 = opaco; o alpha manda

  for (let y = 0; y < lado; y++) {
    const yBmp = lado - 1 - y;
    for (let x = 0; x < lado; x++) {
      const o = (y * lado + x) * 4;
      const d = (yBmp * lado + x) * 4;
      xor[d]     = data[o + 2]; // B
      xor[d + 1] = data[o + 1]; // G
      xor[d + 2] = data[o];     // R
      xor[d + 3] = data[o + 3]; // A
      if (data[o + 3] === 0) and[yBmp * linhaMascara + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

async function main() {
  const imagens = [];
  for (const lado of TAMANHOS) {
    imagens.push({ lado, dados: lado === 256 ? await pngDe(lado) : await bmpDe(lado) });
  }

  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);              // reservado
  cabecalho.writeUInt16LE(1, 2);              // tipo 1 = ícone
  cabecalho.writeUInt16LE(imagens.length, 4);

  const diretorio = Buffer.alloc(16 * imagens.length);
  let deslocamento = cabecalho.length + diretorio.length;
  imagens.forEach(({ lado, dados }, i) => {
    const e = i * 16;
    diretorio.writeUInt8(lado === 256 ? 0 : lado, e);     // largura (0 = 256)
    diretorio.writeUInt8(lado === 256 ? 0 : lado, e + 1); // altura
    diretorio.writeUInt8(0, e + 2);                       // paleta
    diretorio.writeUInt8(0, e + 3);                       // reservado
    diretorio.writeUInt16LE(1, e + 4);                    // planos
    diretorio.writeUInt16LE(32, e + 6);                   // bits por pixel
    diretorio.writeUInt32LE(dados.length, e + 8);
    diretorio.writeUInt32LE(deslocamento, e + 12);
    deslocamento += dados.length;
  });

  fs.writeFileSync(ICO, Buffer.concat([cabecalho, diretorio, ...imagens.map(i => i.dados)]));
  fs.writeFileSync(PNG, await pngDe(256));

  console.log(`assets/icon.ico  ${TAMANHOS.join(', ')}  (${fs.statSync(ICO).size} bytes)`);
  console.log(`assets/icon.png  256x256  (${fs.statSync(PNG).size} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
