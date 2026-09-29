CREATE TABLE ordens_producao (
	id SERIAL PRIMARY KEY,
	numero_op varchar (7) unique, --não pode repetir
	setor varchar (50),
	total_pecas INT check (total_pecas > 0), --não pode ser negativo
	material varchar (100),
	data_abertura DATE,
	dia_analise DATE,
	situacao varchar(50) not null, --não pode ficar vazio
	prioridade varchar(70),
	observacao varchar(400)
);

insert into ordens_producao (numero_op, setor, total_pecas, material, data_abertura, dia_analise, situacao, prioridade)
values ('1131581', 'montagem', 100, '900000115', '21-09-2026', '21-09-2026', 'Falta Pagar', 'Pendencia Comercial');

insert into ordens_producao (numero_op, setor, total_pecas, material, data_abertura, dia_analise, situacao, prioridade)
values ('9999999', 'usinagem', -50, '900000220', '2026-09-22', '2026-09-22', 'Pago', 'Exportacao');

select * from ordens_producao;

drop table ordens_producao;

alter table ordens_producao
add constraint prioridade_valida
check (prioridade IN ('Exportacao', 'KS', 'MWM', 'Pendencia Comercial', 'Marelli', 'Linha Pesada', 'MRP', 'Tryout')); -- checka antes de preencher

select distinct prioridade from ordens_producao; -- o que é distinto da prioridade 

update ordens_producao set prioridade = 'MWM' where prioridade = '03-MWM';
update ordens_producao set prioridade = 'Exportacao' where prioridade = 'Exportação'; --mudar a palavra de prioridade

select * from ordens_producao where situacao = 'Falta Pagar' order by prioridade; --classificar por falta pagar

select * from ordens_producao
where situacao = 'Falta Pagar' -- ordenar

alter table ordens_producao add column peso_prioridade int; -- adicionar coluna de peso para prioridade

UPDATE ordens_producao SET peso_prioridade = 2 WHERE prioridade = 'Exportacao';
UPDATE ordens_producao SET peso_prioridade = 3 WHERE prioridade = 'MWM';
UPDATE ordens_producao SET peso_prioridade = 4 WHERE prioridade = 'KS';
UPDATE ordens_producao SET peso_prioridade = 5 WHERE prioridade = 'Marelli';
UPDATE ordens_producao SET peso_prioridade = 6 WHERE prioridade = 'Pendencia Comercial';
UPDATE ordens_producao SET peso_prioridade = 7 WHERE prioridade = 'Linha Pesada';
UPDATE ordens_producao SET peso_prioridade = 8 WHERE prioridade = 'MRP';
UPDATE ordens_producao SET peso_prioridade = 9 WHERE prioridade = 'Tryout'; -- esta definindo que o peso prioridade será X para a prioridade na frente



