export async function cambioUSDaCOP() {
    try {
            const response = await fetch('/api/tasa');
            if (!response.ok) throw new Error('Error al obtener la tasa de cambio');
                    
            const data = await response.json();
            const tasa = Number(data.valor);

            return tasa;

    } catch (error) {
        console.error('Error fetching tasa:', error);
        throw error
    }
}  

export async function cambioBs() {
    try {
            const response = await fetch('/api/tasaBs');
            if (!response.ok) throw new Error('Error al obtener la tasa de cambio');
                    
            const data = await response.json();
            const tasa = Number(data.valor);

            return tasa;

    } catch (error) {
        console.error('Error fetching tasa:', error);
        throw error
    }
}   

