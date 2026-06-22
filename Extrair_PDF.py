import os
import re
import pdfplumber
import shutil
from pathlib import Path
from PyPDF2 import PdfWriter, PdfReader

# Define os caminhos base para os arquivos e a pasta de saída
caminho_pdf_extraido = "PDF_Extraido" #os.path.join(caminho_base, "PDF_Extraido")



# Nome da variável para armazenar o nome do arquivo "holerites.pdf"
holerite_file = 'holerites.pdf'

# Verifica se o arquivo "holerites.pdf" existe no diretório atual
if os.path.exists(holerite_file):
    print(f'O arquivo \033[92m{holerite_file}\033[0m foi encontrado.')
else:
    print(f'O arquivo \033[91m{holerite_file}\033[0m não foi encontrado. Saindo do programa.')
    exit()

# Nome da variável para armazenar o nome do arquivo "comprovante.pdf"
comprovante_file = 'comprovantes.pdf'

# Verifica se o arquivo "comprovante.pdf" existe no diretório atual
if os.path.exists(comprovante_file):
    print(f'O arquivo \033[92m{comprovante_file}\033[0m foi encontrado.')
else:
    print(f'O arquivo \033[91m{comprovante_file}\033[0m não foi encontrado. Saindo do programa.')
    exit()

# Cria a pasta 'PDF_Extraido' se ela não existir
if os.path.exists(caminho_pdf_extraido):
  shutil.rmtree(caminho_pdf_extraido)
    

if not os.path.exists(caminho_pdf_extraido):
    os.makedirs(caminho_pdf_extraido)

# Caminhos para os arquivos PDF de holerites e comprovantes
arquivo_holerites = "holerites.pdf"
arquivo_comprovantes = "comprovantes.pdf"



# Função para extrair nomes e números de páginas dos holerites
def extrair_nomes_e_paginas(arquivo):
    nomes_paginas = {}
    with pdfplumber.open(arquivo) as pdf:
        for i, page in enumerate(pdf.pages):
            texto = page.extract_text()
            if texto:
                matches = re.findall(r'Empregado\.\:\s*\d+\s*-\s*([\w\s\.\-]+?)\s+Admissão', texto)
                for match in matches:
                    nome = match.strip()
                    if nome not in nomes_paginas:
                        nomes_paginas[nome] = [i]
                    else:
                        nomes_paginas[nome].append(i)
    return nomes_paginas

# Extrai nomes e números de páginas dos holerites
nomes_paginas_holerites = extrair_nomes_e_paginas(arquivo_holerites)

# Verifica se nomes foram encontrados e processa os documentos
if not nomes_paginas_holerites:
    print("Nenhum nome foi encontrado nos holerites.")
else:
    holerites_reader = PdfReader(arquivo_holerites)
    comprovantes_reader = PdfReader(arquivo_comprovantes)

    # Processa cada nome encontrado nos holerites
    for nome, paginas in nomes_paginas_holerites.items():
        writer = PdfWriter()
        nome_encontrado = False
        
        # Adiciona as páginas dos holerites ao documento final
        for num_pagina in paginas:
            writer.add_page(holerites_reader.pages[num_pagina])

        # Procura pelo nome nos comprovantes e adiciona ao documento se encontrado
        for i, page in enumerate(comprovantes_reader.pages):
            texto = page.extract_text()
            if texto and nome in texto:
                writer.add_page(comprovantes_reader.pages[i])
                nome_encontrado = True
                break

        # Gera um nome seguro para o arquivo e define o caminho de saída
        nome_arquivo_seguro = "".join(c for c in nome if c.isalnum() or c in (" ", "_")).rstrip()
        novo_arquivo = os.path.join(caminho_pdf_extraido, f"{nome_arquivo_seguro}.pdf" if nome_encontrado else f"_Sem_comprovante_{nome_arquivo_seguro}.pdf")
        
        # Salva o documento final
        with open(novo_arquivo, 'wb') as f:
            writer.write(f)
        print(f"Arquivo salvo em: '{novo_arquivo}'")
