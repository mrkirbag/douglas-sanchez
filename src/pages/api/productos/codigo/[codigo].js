import { db } from '../../db';
import { verificarToken } from '@/utils/auth';

function normalizarCodigo(codigo) {
    return String(codigo || '').trim().toUpperCase();
}

export async function GET({ request, params }) {

    const usuario = await verificarToken(request);
    if (!usuario) {
        return new Response('No autorizado', { status: 401 });
    }

    try {
        const codigo = normalizarCodigo(params.codigo);

        if (!codigo) {
            return new Response(JSON.stringify({ message: 'Código inválido' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 400
            });
        }

        const producto = await db.execute(
            'SELECT * FROM productos WHERE UPPER(TRIM(codigo)) = ? AND estatus = ?',
            [codigo, 'activo']
        );

        if (!producto?.rows?.length) {
            return new Response(JSON.stringify({ message: 'Producto no encontrado' }), {
                headers: { 'Content-Type': 'application/json' },
                status: 404
            });
        }

        return new Response(JSON.stringify(producto.rows[0]), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        });

    } catch (error) {
        console.error('Error fetching producto por código:', error);
        return new Response('Error fetching producto', { status: 500 });
    }
}
