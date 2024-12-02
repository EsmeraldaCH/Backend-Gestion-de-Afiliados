const express = require('express');
const mysql = require('mysql2/promise');
const passport = require('passport');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');

// Crear la aplicación Express primero
const app = express();

// Configuración de middlewares
app.use(cors({
    origin: 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(bodyParser.json());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'cliente')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Nueva ruta para archivos subidos con multer
 
app.use('/archivos', express.static(path.join('D:', 'DocumentosAIKOI'))); // Ruta pública para los archivos subidos

// Configuración de sesiones
app.use(session({
    secret: 'mysecret',
    resave: false,
    saveUninitialized: true,
    cookie: {
         secure: false,
         maxAge: 24 * 60 * 60 * 1000
        }
}));

app.use(passport.initialize());
app.use(passport.session());

// Importar configuración de Passport
require('./auth');

// Configuración de la conexión a MySQL usando pool en lugar de una única conexión
const pool = mysql.createPool({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'usuarios',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Middleware para verificar si el usuario está logueado
function isLoggedIn(req, res, next) {
    req.user ? next() : res.sendStatus(401);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'D://DocumentosAIKOI');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        const filename = `${uniqueSuffix}${path.extname(file.originalname)}`;
        cb(null, filename); // Solo guardamos el nombre del archivo
    }
});

const fileFilter = (req, file, cb) => {
    // Definir tipos de archivo permitidos para cada campo
    const allowedPdfTypes = ['application/pdf'];
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    
    // Verificar el tipo de archivo según el campo específico
    if (file.fieldname === 'fotoPerfil' && allowedImageTypes.includes(file.mimetype)) {
        cb(null, true);
    } else if (allowedPdfTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no soportado. Solo se permiten archivos PDF para documentos y formatos de imagen para la foto de perfil.'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB límite
    }
});

app.post('/registro', async (req, res) => {
    const { correo, contraseña } = req.body;

    try {
        // Validaciones
        if (!correo || !contraseña) {
            return res.status(400).json({ 
                success: false,
                message: 'Correo y contraseña son obligatorios' 
            });
        }

        // Convertir el correo a minúsculas
        const correoNormalizado = correo.toLowerCase();

        // Verificar si el correo ya existe
        const [existingUsers] = await pool.execute(
            'SELECT * FROM beneficiario WHERE correo = ?',
            [correoNormalizado]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'El correo ya está registrado'
            });
        }

        // Encriptar la contraseña
        const saltRounds = 10;
        const contraseñaEncriptada = await bcrypt.hash(contraseña, saltRounds);

        // Insertar nuevo usuario con contraseña encriptada
        const [result] = await pool.execute(
            'INSERT INTO beneficiario (correo, contraseña) VALUES (?, ?)',
            [correoNormalizado, contraseñaEncriptada]
        );

        res.status(201).json({
            success: true,
            message: 'Registro exitoso',
            userId: result.insertId
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Endpoint de login mejorado con lógica específica para perfiles
app.post('/login', async (req, res) => {
    const { correo, contraseña } = req.body;

    try {
        const correoNormalizado = correo.toLowerCase();


// Verificar si es un administrador
const [admins] = await pool.execute(
    'SELECT id, nombre, correo, contraseña, is_principal FROM administrador WHERE correo = ?',
    [correoNormalizado]
);

if (admins.length > 0) {
    const admin = admins[0];

    // Comparar la contraseña proporcionada con la contraseña encriptada en la base de datos
    const isPasswordValid = await bcrypt.compare(contraseña, admin.contraseña);

    if (isPasswordValid) {
        // Convertir is_principal a número para evitar problemas de tipo
        const isPrincipal = admin.is_principal === 1 ? 1 : 0;

        return res.json({
            success: true,
            message: 'Login exitoso',
            role: 'admin',
            redirectUrl: '/admin/dashboard',
            user: {
                id: admin.id,
                nombre: admin.nombre,
                correo: admin.correo,
                isPrincipal: isPrincipal
            }
        });
    } else {
        return res.status(401).json({
            success: false,
            message: 'No encontramos una cuenta con estos datos.'
        });
    }
} 

        // Beneficiarios
        const [users] = await pool.execute(
            'SELECT id, correo, contraseña FROM beneficiario WHERE correo = ?',
            [correoNormalizado]
        );

        if (users.length > 0) {
            const user = users[0];
            const isPasswordValid = await bcrypt.compare(contraseña, user.contraseña);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'No encontramos una cuenta con estos datos.'
                });
            }

            // Verificar en qué tabla tiene registro el beneficiario
            const [niñosRecords] = await pool.execute(
                'SELECT * FROM niños_etapa_terminal WHERE beneficiario_id = ?',
                [user.id]
            );
            const [discapacidadRecords] = await pool.execute(
                'SELECT * FROM discapacidad WHERE beneficiario_id = ?',
                [user.id]
            );
            const [terceraEdadRecords] = await pool.execute(
                'SELECT * FROM tercera_edad WHERE beneficiario_id = ?',
                [user.id]
            );

            let redirectUrl = '/seleccion-beneficiario'; // Por defecto, si no tiene registros

            if (niñosRecords.length > 0) {
                redirectUrl = `/Profile/${user.id}`;
            } else if (discapacidadRecords.length > 0) {
                redirectUrl = `/ProfileDiscapacidad/${user.id}`;
            } else if (terceraEdadRecords.length > 0) {
                redirectUrl = `/ProfileAdultos/${user.id}`;
            }

            return res.json({
                success: true,
                message: 'Login exitoso',
                role: 'beneficiario',
                redirectUrl,
                user: {
                    id: user.id,
                    correo: user.correo,
                    role: 'beneficiario'
                }
            });
        }

        return res.status(401).json({
            success: false,
            message: 'No encontramos una cuenta con estos datos.'
        });
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

// Rutas de autenticación con Google
app.get('/auth/google',
    passport.authenticate('google', { 
        scope: ['email', 'profile'],
        prompt: 'select_account' // Permite seleccionar cuenta siempre
    })
);

app.get('/auth/google/callback',
    passport.authenticate('google', {
        failureRedirect: '/auth/google/failure',
        failureMessage: true
    }),
    (req, res) => {
        try {
            // Verificar si la autenticación fue exitosa
            if (!req.user) {
                throw new Error('Autenticación fallida');
            }
            res.redirect('http://localhost:3000/Profile');
        } catch (error) {
            console.error('Error en callback de Google:', error);
            res.redirect('/auth/google/failure');
        }
    }
);

// Ruta protegida para datos del usuario
app.get('/auth/protected', isLoggedIn, (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Usuario no autenticado'
            });
        }

        const user = {
            displayName: req.user.displayName || 'Usuario sin nombre',
            email: req.user.emails?.[0]?.value || 'No email disponible',
            photo: req.user.photos?.[0]?.value || 'No photo available',
            googleId: req.user.id,
        };

        res.json({
            success: true,
            user
        });
    } catch (error) {
        console.error('Error al obtener datos protegidos:', error);
        res.status(500).json({
            success: false,
            message: 'Error al obtener datos del usuario'
        });
    }
});

// Ruta para actualizar foto de perfil
app.post('/auth/updateProfilePicture', 
    isLoggedIn, 
    upload.single('profilePicture'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: 'No se subió ninguna imagen'
                });
            }

            const newPhotoUrl = `http://localhost:5000/uploads/${req.file.filename}`;
            
            res.json({
                success: true,
                message: 'Foto de perfil actualizada exitosamente',
                user: {
                    ...req.user,
                    photo: newPhotoUrl
                }
            });
        } catch (error) {
            console.error('Error al actualizar foto de perfil:', error);
            res.status(500).json({
                success: false,
                message: 'Error al actualizar la foto de perfil'
            });
        }
    }
);

// Manejo de errores para multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Archivo demasiado grande. Máximo 5MB permitido.'
            });
        }
        return res.status(400).json({
            success: false,
            message: 'Error al subir el archivo.'
        });
    }
    next(error);
});

// Ruta de fallo de autenticación
app.get('/auth/google/failure', (req, res) => {
    res.status(401).json({
        success: false,
        message: 'Falló la autenticación con Google'
    });
});

// Endpoint para cerrar sesión
app.get('/auth/logout', (req, res) => {
    req.logout((err) => {
        if (err) {
            return res.status(500).json({
                success: false,
                message: 'Error al cerrar sesión'
            });
        }
        res.json({
            success: true,
            message: 'Sesión cerrada exitosamente'
        });
    });
});

// Ruta para guardar datos de niños
app.post('/api/ninos', upload.fields([
    { name: 'informeMedico', maxCount: 1 },
    { name: 'historialMedico', maxCount: 1 },
    { name: 'certificadosTratamientosPaliativos', maxCount: 1 },
    { name: 'comprobanteDomicilio', maxCount: 1 },
    { name: 'curpDocumento', maxCount: 1 },
    { name: 'documentoIdentidad', maxCount: 1 },
    { name: 'declaracionImpuestos', maxCount: 1 },
    { name: 'comprobanteIngresos', maxCount: 1 },
    { name: 'cartaAntecedentesNoPenales', maxCount: 1 },
    { name: 'referenciasPersonalesProfesionales', maxCount: 1 },
    { name: 'fotoPerfil', maxCount: 1 }

]), async (req, res) => {
    const datos = req.body;
    const files = req.files;

    try {
        const beneficiarioId = Array.isArray(req.body.beneficiarioId) 
            ? parseInt(req.body.beneficiarioId[0], 10) 
            : parseInt(req.body.beneficiarioId, 10);

        console.log("ID del beneficiario recibido para pruebas:", beneficiarioId);

        // Verificar que el beneficiario existe
        const [beneficiario] = await pool.execute(
            'SELECT id FROM beneficiario WHERE id = ?',
            [beneficiarioId]
        );

        if (beneficiario.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Beneficiario no encontrado'
            });
        }

        // Verificar si ya existe un registro para este beneficiario
        const [existingRecord] = await pool.execute(
            'SELECT beneficiario_id FROM niños_etapa_terminal WHERE beneficiario_id = ?',
            [beneficiarioId]
        );

        if (existingRecord.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un registro para este beneficiario'
            });
        }

    // Asignar las rutas de los archivos a las variables correspondientes
    const informeMedicoRuta = files?.informeMedico ? files.informeMedico[0].path : null;
    const historialMedicoRuta = files?.historialMedico ? files.historialMedico[0].path : null;
    const certificadosTratamientosRuta = files?.certificadosTratamientosPaliativos ? files.certificadosTratamientosPaliativos[0].path : null;
    const comprobanteDomicilioRuta = files?.comprobanteDomicilio ? files.comprobanteDomicilio[0].path : null;
    const curpDocumentoRuta = files?.curpDocumento ? files.curpDocumento[0].path : null;
    const documentoIdentidadRuta = files?.documentoIdentidad ? files.documentoIdentidad[0].path : null;
    const declaracionImpuestosRuta = files?.declaracionImpuestos ? files.declaracionImpuestos[0].path : null;
    const comprobanteIngresosRuta = files?.comprobanteIngresos ? files.comprobanteIngresos[0].path : null;
    const cartaAntecedentesNoPenalesRuta = files?.cartaAntecedentesNoPenales ? files.cartaAntecedentesNoPenales[0].path : null;
    const referenciasPersonalesProfesionalesRuta = files?.referenciasPersonalesProfesionales ? files.referenciasPersonalesProfesionales[0].path : null;
    const fotoPerfilRuta = files?.fotoPerfil ? files.fotoPerfil[0].path : null;

    // Consulta SQL con rutas de los archivos
    const sql = `
        INSERT INTO niños_etapa_terminal (
            beneficiario_id, nombre, apellido_paterno, apellido_materno, edad, sexo, fecha_nacimiento, curp, nivel_estudios,
            domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, telefono_fijo,
            telefono_fijo_extra, telefono_movil, telefono_movil_extra, servicios_vivienda, servicios_comunitarios,
            antecedentes_patologicos, servicios_salud, informe_medico, historial_medico, certificados_tratamientos_paliativos, descripcion_apoyo, 
            comprobante_domicilio, curp_documento, documento_identidad, declaracion_impuestos,
            comprobante_ingresos, carta_antecedentes_no_penales, referencias_personales_profesionales, foto_perfil
        )   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const valores = [
        beneficiarioId, 
        datos.nombre || null,
        datos.apellidoPaterno || null,
        datos.apellidoMaterno || null,
        datos.edad || null,
        datos.sexo || null,
        datos.fechaNacimiento || null,
        datos.curp || null,
        datos.nivelEstudios || null,
        datos.domicilio || null,
        datos.colonia || null,
        datos.municipio || null,
        datos.estado || null,
        datos.codigoPostal || null,
        datos.referencia || null,
        datos.telefonoFijo || null,
        datos.telefonoFijoExtra || null,
        datos.telefonoMovil || null,
        datos.telefonoMovilExtra || null,
        datos.serviciosVivienda || null,
        datos.serviciosComunitarios || null,
        datos.antecedentesPatologicos || null,  
        datos.serviciosSalud || null,           
        informeMedicoRuta,  // Ruta del archivo PDF
        historialMedicoRuta, 
        certificadosTratamientosRuta,  
        datos.descripcionApoyo || null,
        comprobanteDomicilioRuta,
        curpDocumentoRuta,
        documentoIdentidadRuta,
        declaracionImpuestosRuta,
        comprobanteIngresosRuta,
        cartaAntecedentesNoPenalesRuta,
        referenciasPersonalesProfesionalesRuta,
        fotoPerfilRuta,
    ];

    // Ejecutar la consulta
    const [result] = await pool.execute(sql, valores);

    res.status(201).json({
        success: true,
        message: 'Datos guardados correctamente',
        id: result.insertId
    });
} catch (error) {
    console.error('Error en el registro de niño:', error);
    res.json({ message: 'Datos procesados correctamente' });
    res.status(500).json({
        success: false,
        message: 'Error al guardar los datos',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
});

// Ruta para obtener todos los datos de la tabla niños_etapa_terminal
app.get('/api/ninos', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM niños_etapa_terminal');
      res.json(rows); // Enviar los datos en formato JSON
    } catch (error) {
      console.error('Error al obtener datos de niños:', error);
      res.status(500).json({ error: 'Error al obtener datos' });
    }
  });

// Ruta para obtener los datos de un niño específico
app.get('/api/ninos/:id', async (req, res) => {
    const { id } = req.params; // Extraer el ID del parámetro de la URL
    try {
        const [rows] = await pool.query(
            'SELECT * FROM niños_etapa_terminal WHERE beneficiario_id = ?',
            [id]
        );
        if (rows.length > 0) {
            res.json(rows[0]); // Enviar solo el primer registro
        } else {
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Error al obtener el usuario:', error);
        res.status(500).json({ error: 'Error al obtener el usuario' });
    }
});

// Ruta para guardar datos de discapacidad
app.post('/api/discapacidad', upload.fields([
    { name: 'certificadosDiscapacidad', maxCount: 1 },
    { name: 'comprobanteDomicilio', maxCount: 1 },
    { name: 'curpDocumento', maxCount: 1 },
    { name: 'documentoIdentidad', maxCount: 1 },
    { name: 'declaracionImpuestos', maxCount: 1 },
    { name: 'comprobanteIngresos', maxCount: 1 },
    { name: 'cartaAntecedentesNoPenales', maxCount: 1 },
    { name: 'referenciasPersonalesProfesionales', maxCount: 1 },
    { name: 'certificadosAcademicos', maxCount: 1 },
    { name: 'diplomasTitulos', maxCount: 1 },
    { name: 'fotoPerfil', maxCount: 1 }

]), async (req, res) => {
    const datos = req.body;
    const files = req.files;

    try {
        const beneficiarioId = Array.isArray(req.body.beneficiarioId) 
            ? parseInt(req.body.beneficiarioId[0], 10) 
            : parseInt(req.body.beneficiarioId, 10);

        console.log("ID del beneficiario recibido para pruebas:", beneficiarioId);

        // Verificar que el beneficiario existe
        const [beneficiario] = await pool.execute(
            'SELECT id FROM beneficiario WHERE id = ?',
            [beneficiarioId]
        );

        if (beneficiario.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Beneficiario no encontrado'
            });
        }

        // Verificar si ya existe un registro para este beneficiario
        const [existingRecord] = await pool.execute(
            'SELECT beneficiario_id FROM discapacidad WHERE beneficiario_id = ?',
            [beneficiarioId]
        );

        if (existingRecord.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un registro para este beneficiario'
            });
        }

    // Asignar las rutas de los archivos a las variables correspondientes
    const certificadosDiscapacidadRuta = files?.certificadosDiscapacidad ? files.certificadosDiscapacidad[0].path : null;
    const comprobanteDomicilioRuta = files?.comprobanteDomicilio ? files.comprobanteDomicilio[0].path : null;
    const curpDocumentoRuta = files?.curpDocumento ? files.curpDocumento[0].path : null;
    const documentoIdentidadRuta = files?.documentoIdentidad ? files.documentoIdentidad[0].path : null;
    const declaracionImpuestosRuta = files?.declaracionImpuestos ? files.declaracionImpuestos[0].path : null;
    const comprobanteIngresosRuta = files?.comprobanteIngresos ? files.comprobanteIngresos[0].path : null;
    const cartaAntecedentesNoPenalesRuta = files?.cartaAntecedentesNoPenales ? files.cartaAntecedentesNoPenales[0].path : null;
    const referenciasPersonalesProfesionalesRuta = files?.referenciasPersonalesProfesionales ? files.referenciasPersonalesProfesionales[0].path : null;
    
    const certificadosAcademicosRuta = files?.certificadosAcademicos ? files.certificadosAcademicos[0].path : null;
    const diplomasTitulosRuta = files?.diplomasTitulos ? files.diplomasTitulos[0].path : null;
    const fotoPerfilRuta = files?.fotoPerfil ? files.fotoPerfil[0].path : null;

    // Consulta SQL con rutas de los archivos
    const sql = `
        INSERT INTO discapacidad (
            beneficiario_id, nombre, apellido_paterno, apellido_materno, numero_identificacion_fiscal, sexo, fecha_nacimiento, edad, estado_civil, hijos, ocupacion, curp, nivel_estudios,
            domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, telefono_fijo,
            telefono_fijo_extra, telefono_movil, telefono_movil_extra, servicios_vivienda, servicios_comunitarios,
            antecedentes_patologicos, servicios_salud, certificados_discapacidad, descripcion_apoyo, 
            comprobante_domicilio, curp_documento, documento_identidad, declaracion_impuestos,
            comprobante_ingresos, carta_antecedentes_no_penales, referencias_personales_profesionales, certificados_academicos, diplomas_titulos, foto_perfil
        )   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const valores = [
        beneficiarioId, 
        datos.nombre || null,
        datos.apellidoPaterno || null,
        datos.apellidoMaterno || null,
        datos.numeroIdentificacionFiscal || null, //nuevo
        datos.sexo || null,
        datos.fechaNacimiento || null,
        datos.edad || null, 
        datos.estadoCivil || null, // nuevo
        datos.hijos || null,  // nuevo
        datos.ocupacion || null, // nuevo
        datos.curp || null,
        datos.nivelEstudios || null,
        datos.domicilio || null,
        datos.colonia || null,
        datos.municipio || null,
        datos.estado || null,
        datos.codigoPostal || null,
        datos.referencia || null,
        datos.telefonoFijo || null,
        datos.telefonoFijoExtra || null,
        datos.telefonoMovil || null,
        datos.telefonoMovilExtra || null,
        datos.serviciosVivienda || null,
        datos.serviciosComunitarios || null,
        datos.antecedentesPatologicos || null,  
        datos.serviciosSalud || null,           
        certificadosDiscapacidadRuta,  // nuevo
        datos.descripcionApoyo || null,
        comprobanteDomicilioRuta,
        curpDocumentoRuta,
        documentoIdentidadRuta,
        declaracionImpuestosRuta,
        comprobanteIngresosRuta,
        cartaAntecedentesNoPenalesRuta,
        referenciasPersonalesProfesionalesRuta,
        certificadosAcademicosRuta,  // nuevo
        diplomasTitulosRuta, // nuevo
        fotoPerfilRuta,
    ];

    // Ejecutar la consulta
    const [result] = await pool.execute(sql, valores);

    res.status(201).json({
        success: true,
        message: 'Datos guardados correctamente',
        id: result.insertId
    });
} catch (error) {
    console.error('Error en el registro de discapacidad:', error);
    res.json({ message: 'Datos procesados correctamente' });
    res.status(500).json({
        success: false,
        message: 'Error al guardar los datos',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
});

// Ruta para obtener todos los datos de la tabla discapacidad
app.get('/api/discapacidad', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM discapacidad');
      res.json(rows); // Enviar los datos en formato JSON
    } catch (error) {
      console.error('Error al obtener datos de discapacidad:', error);
      res.status(500).json({ error: 'Error al obtener datos' });
    }
  });

// Ruta para obtener los datos de discapacidad específico
app.get('/api/discapacidad/:id', async (req, res) => {
    const { id } = req.params; // Extraer el ID del parámetro de la URL
    try {
        const [rows] = await pool.query(
            'SELECT * FROM discapacidad WHERE beneficiario_id = ?',
            [id]
        );
        if (rows.length > 0) {
            res.json(rows[0]); // Enviar solo el primer registro
        } else {
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Error al obtener el usuario:', error);
        res.status(500).json({ error: 'Error al obtener el usuario' });
    }
});

// Ruta para guardar datos de tercera_edad
app.post('/api/adulto', upload.fields([
    { name: 'comprobanteDomicilio', maxCount: 1 },
    { name: 'curpDocumento', maxCount: 1 },
    { name: 'documentoIdentidad', maxCount: 1 },
    { name: 'declaracionImpuestos', maxCount: 1 },
    { name: 'comprobanteIngresos', maxCount: 1 },
    { name: 'cartaAntecedentesNoPenales', maxCount: 1 },
    { name: 'referenciasPersonalesProfesionales', maxCount: 1 },
    { name: 'certificadosAcademicos', maxCount: 1 },
    { name: 'diplomasTitulos', maxCount: 1 },
    { name: 'fotoPerfil', maxCount: 1 }

]), async (req, res) => {
    const datos = req.body;
    const files = req.files;

    try {
        const beneficiarioId = Array.isArray(req.body.beneficiarioId) 
            ? parseInt(req.body.beneficiarioId[0], 10) 
            : parseInt(req.body.beneficiarioId, 10);

        console.log("ID del beneficiario recibido para pruebas:", beneficiarioId);

        // Verificar que el beneficiario existe
        const [beneficiario] = await pool.execute(
            'SELECT id FROM beneficiario WHERE id = ?',
            [beneficiarioId]
        );

        if (beneficiario.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Beneficiario no encontrado'
            });
        }

        // Verificar si ya existe un registro para este beneficiario
        const [existingRecord] = await pool.execute(
            'SELECT beneficiario_id FROM discapacidad WHERE beneficiario_id = ?',
            [beneficiarioId]
        );

        if (existingRecord.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Ya existe un registro para este beneficiario'
            });
        }

    // Asignar las rutas de los archivos a las variables correspondientes
    const comprobanteDomicilioRuta = files?.comprobanteDomicilio ? files.comprobanteDomicilio[0].path : null;
    const curpDocumentoRuta = files?.curpDocumento ? files.curpDocumento[0].path : null;
    const documentoIdentidadRuta = files?.documentoIdentidad ? files.documentoIdentidad[0].path : null;
    const declaracionImpuestosRuta = files?.declaracionImpuestos ? files.declaracionImpuestos[0].path : null;
    const comprobanteIngresosRuta = files?.comprobanteIngresos ? files.comprobanteIngresos[0].path : null;
    const cartaAntecedentesNoPenalesRuta = files?.cartaAntecedentesNoPenales ? files.cartaAntecedentesNoPenales[0].path : null;
    const referenciasPersonalesProfesionalesRuta = files?.referenciasPersonalesProfesionales ? files.referenciasPersonalesProfesionales[0].path : null;
    
    const certificadosAcademicosRuta = files?.certificadosAcademicos ? files.certificadosAcademicos[0].path : null;
    const diplomasTitulosRuta = files?.diplomasTitulos ? files.diplomasTitulos[0].path : null;
    const fotoPerfilRuta = files?.fotoPerfil ? files.fotoPerfil[0].path : null;

    // Consulta SQL con rutas de los archivos
    const sql = `
        INSERT INTO tercera_edad (
            beneficiario_id, nombre, apellido_paterno, apellido_materno, numero_identificacion_fiscal, sexo, fecha_nacimiento, edad, estado_civil, hijos, ocupacion, curp, nivel_estudios,
            domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, telefono_fijo,
            telefono_fijo_extra, telefono_movil, telefono_movil_extra, servicios_vivienda, servicios_comunitarios,
            antecedentes_patologicos, servicios_salud, descripcion_apoyo, 
            comprobante_domicilio, curp_documento, documento_identidad, declaracion_impuestos,
            comprobante_ingresos, carta_antecedentes_no_penales, referencias_personales_profesionales, certificados_academicos, diplomas_titulos, foto_perfil
        )   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const valores = [
        beneficiarioId, 
        datos.nombre || null,
        datos.apellidoPaterno || null,
        datos.apellidoMaterno || null,
        datos.numeroIdentificacionFiscal || null, //nuevo
        datos.sexo || null,
        datos.fechaNacimiento || null,
        datos.edad || null, 
        datos.estadoCivil || null, // nuevo
        datos.hijos || null,  // nuevo
        datos.ocupacion || null, // nuevo
        datos.curp || null,
        datos.nivelEstudios || null,
        datos.domicilio || null,
        datos.colonia || null,
        datos.municipio || null,
        datos.estado || null,
        datos.codigoPostal || null,
        datos.referencia || null,
        datos.telefonoFijo || null,
        datos.telefonoFijoExtra || null,
        datos.telefonoMovil || null,
        datos.telefonoMovilExtra || null,
        datos.serviciosVivienda || null,
        datos.serviciosComunitarios || null,
        datos.antecedentesPatologicos || null,  
        datos.serviciosSalud || null,           
        datos.descripcionApoyo || null,
        comprobanteDomicilioRuta,
        curpDocumentoRuta,
        documentoIdentidadRuta,
        declaracionImpuestosRuta,
        comprobanteIngresosRuta,
        cartaAntecedentesNoPenalesRuta,
        referenciasPersonalesProfesionalesRuta,
        certificadosAcademicosRuta,  // nuevo
        diplomasTitulosRuta, // nuevo
        fotoPerfilRuta,
    ];

    // Ejecutar la consulta
    const [result] = await pool.execute(sql, valores);

    res.status(201).json({
        success: true,
        message: 'Datos guardados correctamente',
        id: result.insertId
    });
} catch (error) {
    console.error('Error en el registro de Tercera Edad:', error);
    res.json({ message: 'Datos procesados correctamente' });
    res.status(500).json({
        success: false,
        message: 'Error al guardar los datos',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}
});

// Ruta para obtener todos los datos de la tabla tercera_edad
app.get('/api/adulto', async (req, res) => {
    try {
      const [rows] = await pool.query('SELECT * FROM tercera_edad');
      res.json(rows); // Enviar los datos en formato JSON
    } catch (error) {
      console.error('Error al obtener datos de discapacidad:', error);
      res.status(500).json({ error: 'Error al obtener datos' });
    }
  });

// Ruta para obtener los datos de tercera_edad específico
app.get('/api/adulto/:id', async (req, res) => {
    const { id } = req.params; // Extraer el ID del parámetro de la URL
    try {
        const [rows] = await pool.query(
            'SELECT * FROM tercera_edad WHERE beneficiario_id = ?',
            [id]
        );
        if (rows.length > 0) {
            res.json(rows[0]); // Enviar solo el primer registro
        } else {
            res.status(404).json({ error: 'Usuario no encontrado' });
        }
    } catch (error) {
        console.error('Error al obtener el usuario:', error);
        res.status(500).json({ error: 'Error al obtener el usuario' });
    }
});

// Ruta para eliminar un beneficiario y registros relacionados
app.delete('/api/beneficiarios/:id', async (req, res) => {
    const { id } = req.params; // Extraer el ID del parámetro de la URL
    try {
        // Intentar eliminar el beneficiario
        const [result] = await pool.query('DELETE FROM beneficiario WHERE id = ?', [id]);
        
        if (result.affectedRows > 0) {
            res.json({ message: 'Beneficiario eliminado exitosamente' });
        } else {
            res.status(404).json({ error: 'Beneficiario no encontrado' });
        }
    } catch (error) {
        console.error('Error al eliminar el beneficiario:', error);
        res.status(500).json({ error: 'Error al eliminar el beneficiario' });
    }
});

app.post('/api/admin/add-admin', async (req, res) => {
    const { nombre, correo, contraseña, curp} = req.body;
  
    // Validar que los campos estén completos
    if (!nombre || !correo || !contraseña || !curp) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }
  
    try {
      // Verificar si el correo ya está registrado en la base de datos
      const [existingAdmin] = await pool.query('SELECT * FROM administrador WHERE correo = ?', [correo]);
      if (existingAdmin.length > 0) {
        return res.status(409).json({ error: 'El correo ya está registrado' });
      }
  
      // Verificar si ya existe un administrador principal
      const [principalAdmin] = await pool.query('SELECT * FROM administrador WHERE is_principal = 1');
      
      let isPrincipal = 0; // Por defecto, el nuevo administrador será un administrador normal
      if (principalAdmin.length === 0) {
        // Si no existe ningún administrador principal, asignamos este rol al primer registro
        isPrincipal = 1;
      }
  
      // Encriptar la contraseña con bcrypt
      const hashedPassword = await bcrypt.hash(contraseña, 10);
      const curpRegex = /^[A-Z]{4}\d{6}[A-Z]{6}\d{2}$/;

  

  
      // Insertar el nuevo administrador en la base de datos
      const [result] = await pool.query(
        'INSERT INTO administrador (nombre, correo, curp, contraseña, is_principal) VALUES (?, ?, ?, ?, ?)',
        [nombre, correo, curp, hashedPassword, isPrincipal]
      );
  
      // Enviar una respuesta exitosa con el ID del nuevo administrador
      res.status(201).json({ message: 'Administrador agregado correctamente', id: result.insertId });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al agregar el administrador' });
    }
  });

// Ruta para obtener administradores activos e inactivos
app.get('/api/admin/list', async (req, res) => {
    try {
      const [activos] = await pool.query('SELECT id, nombre, correo, curp, "Activo" as estado FROM administrador WHERE contraseña IS NOT NULL');
      const [inactivos] = await pool.query('SELECT id, nombre, correo, curp, "Inactivo" as estado FROM administrador WHERE contraseña IS NULL');
  
      res.json({ activos, inactivos });
    } catch (error) {
      console.error('Error al obtener la lista de administradores:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });
  
// Ruta para desactivar a un administrador con validación de contraseña
app.post('/api/admin/deactivate', async (req, res) => {
    const { adminId, principalPassword } = req.body;
  
    try {
      // 1. Verificar si la contraseña corresponde al administrador principal
      const [principalAdmin] = await pool.query(
        'SELECT contraseña FROM administrador WHERE is_principal = 1 LIMIT 1'
      );
  
      if (!principalAdmin.length) {
        return res.status(403).json({ message: 'No se encontró el administrador principal.' });
      }
  
      const isPasswordValid = await bcrypt.compare(
        principalPassword,
        principalAdmin[0].contraseña
      );
  
      if (!isPasswordValid) {
        return res.status(403).json({ message: 'Contraseña incorrecta.' });
      }
  
      // 2. Proceder con la desactivación
      await pool.query('UPDATE administrador SET contraseña = NULL WHERE id = ?', [adminId]);
      res.json({ message: 'Administrador desactivado correctamente.' });
    } catch (error) {
      console.error('Error al desactivar el administrador:', error);
      res.status(500).json({ message: 'Error interno del servidor.' });
    }
  });
// Ruta para actualizar los datos de niños
app.put('/api/ninos/:id', async (req, res) => {
    const { 
        nombre, apellido_paterno, apellido_materno, edad, sexo, curp, nivel_estudios,
        domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, telefono_fijo,
        telefono_movil, descripcion_apoyo
    } = req.body;

    // Obtener el 'id' de la URL
    const { id } = req.params;  // Aquí accedes al 'id' de la URL

    // Validar los campos requeridos. Si deseas realizar validaciones más específicas, ajusta según sea necesario.
    if (!nombre || !apellido_paterno || !apellido_materno ) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    try {
        const [result] = await pool.query(
            `
            UPDATE niños_etapa_terminal
            SET 
                nombre = ?, apellido_paterno = ?, apellido_materno = ?, edad = ?, sexo = ?, curp = ?, nivel_estudios = ?,
                domicilio_calle_numero = ?, colonia = ?, municipio = ?, estado = ?, codigo_postal = ?, referencia = ?, telefono_fijo = ?, 
                telefono_movil = ?, descripcion_apoyo = ?
            WHERE beneficiario_id = ?;
            `,
            [
                nombre, apellido_paterno, apellido_materno, edad, sexo, curp, nivel_estudios,
                domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, telefono_fijo, 
                telefono_movil, descripcion_apoyo,
                id // Ahora el 'id' está definido y se pasa a la consulta
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.status(200).json({ message: 'Usuario actualizado con éxito' });
    } catch (error) {
        console.error('Error al actualizar el usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para actualizar los datos de tercera edad
app.put('/api/adulto/:id', async (req, res) => {
    const { 
        nombre, apellido_paterno, apellido_materno, sexo, estado_civil, curp,
        domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, ocupacion, nivel_estudios,
        telefono_fijo, telefono_movil, hijos, descripcion_apoyo 
    } = req.body;

    // Obtener el 'id' de la URL
    const { id } = req.params;

    // Validar los campos requeridos
    if (!nombre || !apellido_paterno || !apellido_materno || !sexo) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    try {
        const [result] = await pool.query(
            `
            UPDATE tercera_edad
            SET 
                nombre = ?, apellido_paterno = ?, apellido_materno = ?, sexo = ?, estado_civil = ?, 
                curp = ?, domicilio_calle_numero = ?, colonia = ?, municipio = ?, estado = ?, codigo_postal = ?, referencia = ?, 
                ocupacion = ?, nivel_estudios = ?, telefono_fijo = ?, telefono_movil = ?, hijos = ?, descripcion_apoyo = ?
            WHERE beneficiario_id = ?;
            `,
            [
                nombre, apellido_paterno, apellido_materno, sexo, estado_civil, curp,
                domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, ocupacion, nivel_estudios,
                telefono_fijo, telefono_movil, hijos, descripcion_apoyo,
                id // Aquí estamos pasando el 'id' para identificar el registro
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.status(200).json({ message: 'Usuario de tercera edad actualizado con éxito' });
    } catch (error) {
        console.error('Error al actualizar el usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para actualizar los datos de discapacidad
app.put('/api/discapacidad/:id', async (req, res) => {
    const { 
        nombre, apellido_paterno, apellido_materno, sexo, estado_civil, curp,
        domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, ocupacion, nivel_estudios,
        telefono_fijo, telefono_movil, hijos, descripcion_apoyo 
    } = req.body;

    // Obtener el 'id' de la URL
    const { id } = req.params;

    // Validar los campos requeridos
    if (!nombre || !apellido_paterno || !apellido_materno || !sexo) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
    }

    try {
        const [result] = await pool.query(
            `
            UPDATE discapacidad
            SET 
                nombre = ?, apellido_paterno = ?, apellido_materno = ?, sexo = ?, estado_civil = ?, 
                curp = ?, domicilio_calle_numero = ?, colonia = ?, municipio = ?, estado = ?, codigo_postal = ?, referencia = ?, 
                ocupacion = ?, nivel_estudios = ?, telefono_fijo = ?, telefono_movil = ?, hijos = ?, descripcion_apoyo = ?
            WHERE beneficiario_id = ?;
            `,
            [
                nombre, apellido_paterno, apellido_materno, sexo, estado_civil, curp,
                domicilio_calle_numero, colonia, municipio, estado, codigo_postal, referencia, ocupacion, nivel_estudios,
                telefono_fijo, telefono_movil, hijos, descripcion_apoyo,
                id // Aquí estamos pasando el 'id' para identificar el registro
            ]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        res.status(200).json({ message: 'Usuario con discapacidad actualizado con éxito' });
    } catch (error) {
        console.error('Error al actualizar el usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.put('/api/administradores/:id', async (req, res) => {
    const { nombre, correo, curp, nuevaContrasena } = req.body;
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ error: 'ID del administrador es obligatorio' });
    }

    if (!nombre || nombre.trim() === '') {
        return res.status(400).json({ error: 'El nombre es obligatorio' });
    }

    try {
        const adminId = parseInt(id, 10);

        if (isNaN(adminId)) {
            return res.status(400).json({ error: 'ID de administrador inválido' });
        }

        let query, values;
        let hashedPassword;

        // Preparar la consulta dependiendo de si hay nueva contraseña
        if (nuevaContrasena) {
            const saltRounds = 10;
            hashedPassword = await bcrypt.hash(nuevaContrasena, saltRounds);

            query = `
                UPDATE administrador 
                SET nombre = ?, correo = ?, curp = ?, contraseña = ?
                WHERE id = ?
            `;
            values = [nombre.trim(), correo, curp, hashedPassword, adminId];
        } else {
            query = `
                UPDATE administrador 
                SET nombre = ?, correo = ?, curp = ?
                WHERE id = ?
            `;
            values = [nombre.trim(), correo, curp, adminId];
        }

        const [result] = await pool.query(query, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Administrador no encontrado' });
        }

        res.status(200).json({ message: 'Administrador actualizado con éxito' });
    } catch (error) {
        console.error('Error al actualizar el administrador:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            detalle: error.message 
        });
    }
});

// Endpoint para obtener datos del administrador
app.get('/api/administradores/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const adminId = parseInt(id, 10);

        if (isNaN(adminId)) {
            return res.status(400).json({ error: 'ID de administrador inválido' });
        }

        const [rows] = await pool.query(
            'SELECT nombre, correo, curp FROM administrador WHERE id = ?', 
            [adminId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Administrador no encontrado' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('Error al obtener los datos del administrador:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para obtener estadísticas de los niños en etapa terminal
app.get('/api/estadisticas/ninos', async (req, res) => {
    try {
      // Obtener estadísticas de sexo
      const [sexo] = await pool.query('SELECT sexo, COUNT(*) AS count FROM niños_etapa_terminal GROUP BY sexo');
  
      // Obtener estadísticas de edad (1 a 18 años)
      const [edad] = await pool.query('SELECT edad, COUNT(*) AS count FROM niños_etapa_terminal WHERE edad BETWEEN 1 AND 18 GROUP BY edad');
  
      // Obtener estadísticas de estado
      const [estado] = await pool.query('SELECT estado, COUNT(*) AS count FROM niños_etapa_terminal GROUP BY estado');
  
      // Obtener estadísticas de nivel de estudios
      const [nivel_estudios] = await pool.query('SELECT nivel_estudios, COUNT(*) AS count FROM niños_etapa_terminal GROUP BY nivel_estudios');
  
      res.json({ sexo, edad, estado, nivel_estudios });
    } catch (error) {
      console.error('Error al obtener estadísticas de niños:', error);
      res.status(500).json({ error: 'Error al obtener estadísticas de niños' });
    }
  });

  // Ruta para obtener estadísticas de personas con discapacidad
app.get('/api/estadisticas/personas-discapacidad', async (req, res) => {
    try {
      // Obtener estadísticas de sexo
      const [sexo] = await pool.query('SELECT sexo, COUNT(*) AS count FROM discapacidad GROUP BY sexo');
  
      // Obtener estadísticas de edad (1 a 100 años)
      const [edad] = await pool.query('SELECT edad, COUNT(*) AS count FROM discapacidad WHERE edad BETWEEN 1 AND 100 GROUP BY edad');
  
      // Obtener estadísticas de estado
      const [estado] = await pool.query('SELECT estado, COUNT(*) AS count FROM discapacidad GROUP BY estado');
  
      // Obtener estadísticas de nivel de estudios
      const [nivel_estudios] = await pool.query('SELECT nivel_estudios, COUNT(*) AS count FROM discapacidad GROUP BY nivel_estudios');
  
      res.json({ sexo, edad, estado, nivel_estudios});
    } catch (error) {
      console.error('Error al obtener estadísticas de personas con discapacidad:', error);
      res.status(500).json({ error: 'Error al obtener estadísticas de personas con discapacidad' });
    }
  });
  
  // Ruta para obtener estadísticas de los adultos mayores
app.get('/api/estadisticas/adultos-mayores', async (req, res) => {
    try {
      // Obtener estadísticas de sexo
      const [sexo] = await pool.query('SELECT sexo, COUNT(*) AS count FROM tercera_edad GROUP BY sexo');
  
      // Obtener estadísticas de edad (60 a 100 años)
      const [edad] = await pool.query('SELECT edad, COUNT(*) AS count FROM tercera_edad WHERE edad BETWEEN 60 AND 100 GROUP BY edad');
  
      // Obtener estadísticas de estado
      const [estado] = await pool.query('SELECT estado, COUNT(*) AS count FROM tercera_edad GROUP BY estado');
  
      // Obtener estadísticas de nivel de estudios
      const [nivel_estudios] = await pool.query('SELECT nivel_estudios, COUNT(*) AS count FROM tercera_edad GROUP BY nivel_estudios');
  
      res.json({ sexo, edad, estado, nivel_estudios });
    } catch (error) {
      console.error('Error al obtener estadísticas de adultos mayores:', error);
      res.status(500).json({ error: 'Error al obtener estadísticas de adultos mayores' });
    }
  });

// Iniciar el servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});